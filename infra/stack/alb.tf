# The load balancer architecture.md has always described and `enable_alb = false` never built. There
# is no flag here: an ALB either exists or the application cannot be reached, and a variable nothing
# reads is worse than no variable (D-34).
#
# It listens on plain HTTP, which is safe only because two things are true: its security group admits
# CloudFront's origin ranges alone, and its one forwarding rule requires a header only CloudFront
# sends. TLS terminates at CloudFront with a certificate that costs nothing (D-08).

resource "aws_lb" "main" {
  name               = "${local.name_prefix}-alb"
  load_balancer_type = "application"
  internal           = false
  subnets            = aws_subnet.public[*].id
  security_groups    = [aws_security_group.alb.id]

  idle_timeout               = 60
  drop_invalid_header_fields = true
  enable_http2               = true

  # Nothing here is stateful. Blocking a destroy would be friction with no data to protect; the
  # database and the uploads bucket are where that guard belongs.
  enable_deletion_protection = false

  tags = { Name = "${local.name_prefix}-alb" }
}

resource "aws_lb_target_group" "app" {
  name        = "${local.name_prefix}-app"
  port        = 3000
  protocol    = "HTTP"
  target_type = "ip" # awsvpc networking registers task ENIs, not instances
  vpc_id      = aws_vpc.main.id

  deregistration_delay = 30

  # The application has to implement this route and it has to check the database, because this is
  # what decides whether a deployment is healthy and what the circuit breaker rolls back on.
  health_check {
    enabled             = true
    path                = "/api/health"
    protocol            = "HTTP"
    matcher             = "200"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  tags = { Name = "${local.name_prefix}-app" }
}

# Default answer to anyone who found the load balancer's own hostname: no.
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "fixed-response"

    fixed_response {
      content_type = "text/plain"
      status_code  = "403"
      message_body = "Requests to GrihaOne go through its HTTPS address."
    }
  }
}

resource "aws_lb_listener_rule" "from_cloudfront" {
  listener_arn = aws_lb_listener.http.arn
  priority     = 1

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app.arn
  }

  condition {
    http_header {
      http_header_name = "X-Origin-Verify"
      values           = [random_password.origin_verify.result]
    }
  }
}
