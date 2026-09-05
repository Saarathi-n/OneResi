output "state_bucket" {
  description = "Name of the bucket holding ../stack's state."
  value       = aws_s3_bucket.state.id
}

output "backend_block" {
  description = <<-EOT
    The backend configuration ../stack/versions.tf must contain. It is already written there for
    account 215671569291 in ap-south-1; compare this output against it if you are using a different
    account and correct the file by hand — a backend block cannot take variables.
  EOT
  value       = <<-EOT
    backend "s3" {
      bucket       = "${aws_s3_bucket.state.id}"
      key          = "stack/terraform.tfstate"
      region       = "${var.aws_region}"
      encrypt      = true
      use_lockfile = true
    }
  EOT
}
