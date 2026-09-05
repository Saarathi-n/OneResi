# ADR 0001 — Deploy on AWS with Terraform instead of Vercel

**Status** Accepted · 2026-09-02

## Context

The DA1 Review 1 deck, presented on 27.08.2026, names Vercel as the deployment target, and WBS
work package 6.1 reads "Deployment (Vercel + hosted Postgres)". The project is also serving as
the deliverable for cloud coursework, where provisioning infrastructure as code with Terraform on
AWS is the point of the exercise. Vercel provisions nothing the student writes, so it cannot
satisfy that requirement.

## Decision

Every application-tier choice in the submitted deck stands unchanged — React 18 with Next.js 14,
Tailwind, Recharts, Node 20, Zod, PostgreSQL 16 through Prisma, JWT in an HTTP-only cookie with
bcrypt at cost 12. Only the deployment tier changes: the Next.js build runs as a container on
ECS Fargate behind an Application Load Balancer, with RDS for PostgreSQL, and the whole
environment is provisioned by Terraform.

## Why this rather than a larger change

The submitted architecture slide is a three-tier diagram. Those three tiers map onto this
deployment without redrawing anything: presentation is the browser plus the load balancer,
application is the Fargate task running the same six services the slide lists, data is Postgres.
The class, sequence, activity and state models all assume this stack. Changing language or
framework would falsify them; changing where the container runs does not.

## Consequences

- The stack slide's "Tooling and deployment" line needs one correction, from Vercel to AWS with
  Terraform. Everything else on that slide remains accurate.
- A real recurring cost appears where Vercel's hobby tier was free: roughly $9 a month for
  Fargate if the service is left running. Mitigated by scaling the service to zero between work
  sessions.
- Deployment is no longer a push-to-deploy convenience. It needs a VPC, subnets, security groups,
  a task definition, a load balancer and a database instance, all of which have to be written and
  maintained. That work is the cloud coursework deliverable, so it counts as value rather than
  overhead.
- Secrets move from Vercel environment variables to SSM Parameter Store, and CI authenticates by
  assuming an IAM role over OIDC rather than holding a deploy token.
