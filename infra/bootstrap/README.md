# infra/bootstrap

One bucket. Applied once, ever.

`../stack` keeps its Terraform state in S3, which means the bucket has to exist before the first
`terraform init` in that directory. Something has to create it, and that something cannot itself use
a remote backend. So this directory exists, it uses **local state**, and it provisions exactly one
thing: a versioned, encrypted, private S3 bucket named
`grihaone-tfstate-<account-id>-<region>`.

## Apply it

```
cd infra/bootstrap
terraform init
terraform apply
```

`terraform` here has to be 1.10 or later. The copy first on PATH is not — see the last section.

Two resources' worth of plan, no cost. S3 charges by storage and requests; a few hundred kilobytes
of state and a handful of requests per apply round to zero.

Then confirm the `backend_block` output matches what is already written in
`../stack/versions.tf`. It will, for account `215671569291` in `ap-south-1`. If you are applying
into a different account, edit that file by hand — a `backend` block cannot interpolate variables,
which is the one place in this stack where a value is duplicated on purpose.

## Then never again

Nothing in this directory changes once it is applied. There is no reason to re-run it, and no
`terraform destroy` here: the bucket carries `prevent_destroy = true`, because destroying the state
bucket destroys the ability to destroy the stack, and an AWS account you can no longer tear down is
the expensive failure mode on a student budget.

If you genuinely want the bucket gone — account closure, project over — delete the `lifecycle`
block in `main.tf`, empty the bucket, and destroy. Do that **after** `terraform destroy` in
`../stack`, never before.

## State for this directory

`terraform.tfstate` here is local and roughly forty lines. It is small enough to commit if you want
belt and braces, and the root `.gitignore` currently excludes `*.tfstate`. Losing it is survivable:
the bucket can be re-adopted with `terraform import aws_s3_bucket.state <bucket-name>` and five more
`import` lines for the sub-resources. That is the whole reason this stack was kept to one bucket.

## Why not a DynamoDB lock table

Terraform 1.10 and later lock state in S3 natively with `use_lockfile = true`, so the lock is an
object in this bucket rather than a table with its own lifecycle.

Nothing needs installing to get there: 1.15.8 is already on this machine. A stale 1.9.8 in `~/bin`
comes first on PATH and shadows it, so a bare `terraform` reports 1.9.8 and fails the version
constraint with "Unsupported Terraform Core version" (D-79). Rename that copy, or put the winget
package directory ahead of `~/bin` on PATH, or call the newer binary by its full path — which is what
the commands above mean by `terraform`.
