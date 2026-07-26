terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # No backend block on purpose — this module has never been applied (see
  # README.md). Configure a real backend (S3 + DynamoDB lock table, or
  # Terraform Cloud) before the first `terraform apply`, matching whatever
  # convention the rest of SideQuest's infra ends up using; none exists yet
  # for this repo to follow.
}

provider "aws" {
  region = var.aws_region
}
