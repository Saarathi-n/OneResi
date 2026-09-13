# HTTPS, without buying anything.
#
# The distribution gets a free `*.cloudfront.net` certificate, so the browser sees valid TLS, the
# `Secure` session cookie is sent, and login works. This is the whole fix for the defect that made
# the previous deployment unable to authenticate anyone (D-08). It also terminates closer to the user
# than a Mumbai-only load balancer, and CloudFront's free tier covers this volume completely.
#
# Buy a domain later and the same distribution takes an ACM certificate validated by a Route 53
# record instead. One variable, no other change.

data "aws_cloudfront_cache_policy" "caching_disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_cache_policy" "caching_optimized" {
  name = "Managed-CachingOptimized"
}

data "aws_cloudfront_origin_request_policy" "all_viewer_except_host" {
  name = "Managed-AllViewerExceptHostHeader"
}

data "aws_cloudfront_response_headers_policy" "security_headers" {
  name = "Managed-SecurityHeadersPolicy"
}

resource "aws_acm_certificate" "app" {
  count    = var.enable_cloudfront && local.use_custom_domain ? 1 : 0
  provider = aws.us_east_1

  domain_name       = var.app_domain
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = { Name = "${local.name_prefix}-cert" }
}

resource "aws_route53_record" "app_cert_validation" {
  # Splat and flatten rather than a conditional index: with no custom domain (or no CloudFront at
  # all) the certificate has no instances and this collapses to an empty map on its own.
  for_each = {
    for option in flatten(aws_acm_certificate.app[*].domain_validation_options) : option.domain_name => option
  }

  zone_id         = data.aws_route53_zone.primary[0].zone_id
  name            = each.value.resource_record_name
  type            = each.value.resource_record_type
  records         = [each.value.resource_record_value]
  ttl             = 60
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "app" {
  count    = var.enable_cloudfront && local.use_custom_domain ? 1 : 0
  provider = aws.us_east_1

  certificate_arn         = one(aws_acm_certificate.app[*].arn)
  validation_record_fqdns = [for record in aws_route53_record.app_cert_validation : record.fqdn]
}

resource "aws_cloudfront_distribution" "app" {
  count = var.enable_cloudfront ? 1 : 0
  enabled         = true
  is_ipv6_enabled = true
  comment         = "${local.name_prefix} — TLS termination in front of the load balancer"
  http_version    = "http2and3"

  # PriceClass_100 is cheaper on paper and excludes South Asia, which is where every user of this
  # system is. 200 includes India and the free tier covers the volume either way.
  price_class = "PriceClass_200"

  aliases = local.use_custom_domain ? [var.app_domain] : []

  # An apply should not sit for fifteen minutes waiting for edge propagation. The URL works before
  # the distribution reports Deployed.
  wait_for_deployment = false

  origin {
    domain_name = aws_lb.main.dns_name
    origin_id   = "alb"

    custom_origin_config {
      http_port                = 80
      https_port               = 443
      origin_protocol_policy   = "http-only" # the ALB has no certificate; nothing else can reach it
      origin_ssl_protocols     = ["TLSv1.2"]
      origin_read_timeout      = 60
      origin_keepalive_timeout = 5
    }

    # The load balancer's only forwarding rule requires this header, so the origin cannot be used by
    # anyone else's distribution.
    custom_header {
      name  = "X-Origin-Verify"
      value = random_password.origin_verify.result
    }
  }

  # Everything dynamic: no caching, and every header, cookie and query string forwarded. A session
  # cookie cannot survive a cache.
  default_cache_behavior {
    target_origin_id       = "alb"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_disabled.id
    origin_request_policy_id   = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id
    response_headers_policy_id = data.aws_cloudfront_response_headers_policy.security_headers.id
  }

  # Next.js content-hashes these filenames, so they are immutable and cacheable forever. This is the
  # behaviour that makes CloudFront worth having beyond the certificate.
  ordered_cache_behavior {
    path_pattern           = "/_next/static/*"
    target_origin_id       = "alb"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_optimized.id
    response_headers_policy_id = data.aws_cloudfront_response_headers_policy.security_headers.id
  }

  ordered_cache_behavior {
    path_pattern           = "/icons/*"
    target_origin_id       = "alb"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_optimized.id
    response_headers_policy_id = data.aws_cloudfront_response_headers_policy.security_headers.id
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  # Null attributes are omitted, so this is the free default certificate until app_domain is set. `one`
  # rather than `[0]`, because a conditional does not protect an index into a resource with no instances.
  viewer_certificate {
    cloudfront_default_certificate = local.use_custom_domain ? null : true
    acm_certificate_arn            = one(aws_acm_certificate_validation.app[*].certificate_arn)
    ssl_support_method             = local.use_custom_domain ? "sni-only" : null
    minimum_protocol_version       = local.use_custom_domain ? "TLSv1.2_2021" : null
  }

  tags = { Name = "${local.name_prefix}-cdn" }
}

resource "aws_route53_record" "app_alias" {
  for_each = local.use_custom_domain ? toset(["A", "AAAA"]) : toset([])

  zone_id = data.aws_route53_zone.primary[0].zone_id
  name    = var.app_domain
  type    = each.value

  alias {
    name                   = aws_cloudfront_distribution.app[0].domain_name
    zone_id                = aws_cloudfront_distribution.app[0].hosted_zone_id
    evaluate_target_health = false
  }
}
