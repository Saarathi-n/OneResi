variable "aws_region" {
  type        = string
  default     = "ap-south-1"
  description = "Region the state bucket lives in. Must match the region in ../stack/versions.tf."
}

variable "project_name" {
  type        = string
  default     = "oneresi"
  description = "Prefix for the bucket name. Only change this if you also change ../stack."
}
