# OneResi

Residential community management system. Implementation of the design submitted for
BCSE301L Software Engineering.

Ashvin K S (24BCE1580) · Saarathi Niranjan Kumar (24BCE1536)

The requirements, use cases and UML models live in the coursework workspace at
`C:\Developer\Learning\Notes\Semester\01-Software-Engineering\DA-related`. This repository
holds the running system and the decisions taken while building it.

## Documents

| File | What it holds |
|---|---|
| [docs/plan/](docs/plan/) | **The rebuild plan.** Defect register, target architecture, AWS and Terraform, product design, testing, roadmap |
| [docs/architecture.md](docs/architecture.md) | System context, AWS runtime architecture, request paths, delivery pipeline, service selection and cost |
| [docs/data-model.md](docs/data-model.md) | The corrected 12-entity model, and every place it differs from the submitted DDL |
| [docs/adr/](docs/adr/) | Decision records, including the three deviations from the submitted DA1 deck |

Open either document in a Markdown viewer with Mermaid support to see the diagrams
rendered. VS Code needs the Markdown Preview Mermaid Support extension; GitHub and
Obsidian render them without help.

## Layout

```
apps/web/   Website: marketing, sign-in, committee desk      (planned)
apps/app/   Installable PWA: residents and the gate          (planned)
packages/   contracts · domain · db · ui · mail              (planned)
infra/      Terraform: bootstrap, then the stack             (planned)
docs/       Plan, architecture, data model, decision records
```

## Status

Planned, not scaffolded. [docs/plan/](docs/plan/) holds the rebuild plan: 80 defects catalogued in
the earlier build with the fix for each, the target architecture, a zero-touch Terraform plan, the
product and motion design, the test strategy, and a phased roadmap with gates.

An earlier implementation exists at `C:\Developer\Code\OneResi`. It is reference material now — see
[docs/plan/01-defect-register.md](docs/plan/01-defect-register.md) for why.

Four questions are open at the top of [docs/plan/README.md](docs/plan/README.md). None of them
block phase 0.
