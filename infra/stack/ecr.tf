# The image the previous stack did not have. Its task definition pointed at `node:20-alpine` with a
# comment saying "Default or your ECR URI", there was no Dockerfile anywhere in the repository, and
# no ECR repository in Terraform — so the container started, found no application, exited, and ECS
# restarted it forever (D-09).

resource "aws_ecr_repository" "app" {
  name                 = local.name_prefix
  image_tag_mutability = "MUTABLE" # `latest` and `migrate` are moving tags by design
  force_delete         = local.allow_destructive

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = { Name = "${local.name_prefix}-ecr" }
}

# ECR's free tier is 500 MB for twelve months and the runtime image is a few hundred. Three tagged
# images is one to run, one to roll back to, and one in flight.
resource "aws_ecr_lifecycle_policy" "app" {
  repository = aws_ecr_repository.app.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Expire untagged layers within a day"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 1
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Keep the last three application images"
        selection = {
          tagStatus     = "tagged"
          tagPrefixList = ["v", "sha", "latest"]
          countType     = "imageCountMoreThan"
          countNumber   = 3
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 3
        description  = "Keep the last two migration images"
        selection = {
          tagStatus     = "tagged"
          tagPrefixList = ["migrate"]
          countType     = "imageCountMoreThan"
          countNumber   = 2
        }
        action = { type = "expire" }
      },
    ]
  })
}
