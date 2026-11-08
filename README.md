# AgriTech — Coffee Plant Health Platform

A full-stack application designed to help farmers monitor the health of potted coffee plants through image-based analysis.

The project combines a farmer-facing web application, a Supabase backend, and an independent FastAPI service for machine-learning inference.

## Project Overview

AgriTech is being developed as an agricultural technology prototype with two user roles:

- **Farmer:** registers coffee plants, submits photographs, and reviews plant-health assessments.
- **Administrator:** manages and reviews plant records and submitted assessments.

The application is designed with a mobile-friendly workflow and responsible presentation of machine-learning predictions.

## Main Features

- Farmer authentication and role-based access.
- Coffee plant registration and management.
- Image submission and storage.
- Plant-health assessment workflow.
- Machine-learning inference through a separate API service.
- Database persistence of plant and assessment records.
- Administrative functionality.
- Automated tests and technical documentation.

## Technology Stack

| Component | Technology |
|---|---|
| Frontend | Next.js, React, TypeScript |
| Styling | Tailwind CSS |
| Backend API | Next.js API routes |
| Database | Supabase / PostgreSQL |
| Authentication | Supabase Auth |
| Model service | Python, FastAPI |
| Deep learning | TensorFlow / Keras |
| Image classification | EfficientNetB0 |
| Testing | Vitest, pytest |
| Deployment configuration | Cloudflare Workers / OpenNext |

## Architecture

```text
Farmer / Administrator
         |
         v
 Next.js Web Application
         |
         +------ Supabase Authentication
         |
         +------ Supabase PostgreSQL
         |
         +------ Image Storage
         |
         v
  Model Adapter
         |
         v
  FastAPI Model Service
         |
         +------ Stage 1: Health Classification
         |
         +------ Stage 2: Disease Classification
```

The model service is maintained separately from the Next.js application. The application communicates with it through an HTTP-based model adapter.

## Machine Learning

The current local inference pipeline uses two EfficientNetB0 models.

### Stage 1 — Binary health classification

Classifies an image into:

- Healthy
- Unhealthy

The binary classifier uses a validation-selected threshold of `0.2244` for the Unhealthy probability.

### Stage 2 — Disease classification

When Stage 1 identifies an image as Unhealthy, the second model evaluates four disease categories:

- Miner
- Rust
- Phoma
- Cercospora

The second stage is skipped when the first stage classifies the image as Healthy.

### Dataset and evaluation

The binary health model was trained using the BRACOL coffee-leaf image dataset.

Dataset preparation:

- 1,747 metadata records.
- 1,402 image files located.
- 345 missing image files.
- 1,401 valid images after excluding one corrupt image.
- Training, validation, and test split: 980 / 210 / 211 images.
- Class imbalance addressed using class weights.

Binary classifier test results at the 0.50 threshold:

| Metric | Result |
|---|---:|
| Accuracy | 90.52% |
| ROC AUC | 98.15% |
| Unhealthy F1-score | 94.44% |
| Unhealthy Precision | 99.42% |
| Unhealthy Recall | 89.95% |
| Healthy F1-score | 67.74% |

**Evaluation note:** These metrics correspond to the binary classifier evaluated at a threshold of 0.50. The threshold of 0.2244 was selected using validation data to prioritize Unhealthy recall. Test metrics at that alternative threshold have not been established here.

The disease classifier has a separate evaluation process. Its performance should not be inferred from the binary classifier metrics.

### Important limitations

- The BRACOL dataset contains coffee-leaf images. It does not establish equivalent performance on photographs of entire potted plants.
- Dataset imbalance and missing images affect the available training data.
- Predictions are model outputs, not confirmed agricultural diagnoses.
- Performance on photographs captured by farmers in Puerto Rico requires further field validation.
- Model confidence scores should be interpreted within the limitations of the training data.

## Local Development

### Requirements

- Node.js and npm.
- Python 3.10–3.13 for the model service.
- A Supabase project with the required database schema and configuration.
- The trained model checkpoints for real local inference.

### 1. Clone the repository

```bash
git clone <YOUR_GITHUB_REPOSITORY_URL>
cd plant-health-app
```

### 2. Configure the Next.js application

Copy the environment template:

```powershell
Copy-Item .env.example .env.local
```

Configure the required Supabase and application environment variables in `.env.local`.

Install dependencies:

```bash
npm install
```

### 3. Configure the model service

```powershell
cd model-service
Copy-Item .env.example .env
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
```

Place the required trained checkpoints in:

```text
model-service/checkpoints/
```

Model checkpoints are intentionally excluded from Git.

Configure the model service environment and the Next.js model endpoint so both services use matching addresses and ports.

For additional details, see [Model Service Documentation](model-service/README.md).

### 4. Start the application

In one terminal, start the FastAPI model service using the configured environment:

```bash
cd model-service
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

In another terminal, from the project root:

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

The example port above must match the model endpoint configured in the Next.js environment.

## Testing and Quality Checks

From the project root:

```bash
npm test
npm run lint
npx tsc --noEmit
npm run build
```

From `model-service/`:

```bash
pytest
```

Tests and build results should be rerun against the exact version being submitted.

## Repository Structure

```text
plant-health-app/
├── .github/
│   ├── ISSUE_TEMPLATE/
│   └── workflows/
├── app/                    # Next.js application and API routes
├── assets/
│   ├── diagrams/
│   └── screenshots/
├── components/             # Reusable UI components
├── configs/                # Project configuration documentation
├── data/                   # Dataset documentation and manifests
├── docs/                   # Technical and project documentation
├── hooks/                  # React hooks
├── lib/                    # Application logic and model adapters
├── model-service/          # FastAPI inference service
├── notebooks/              # Model development notebooks
├── public/                 # Static assets
├── reports/
│   └── model-evaluation/
├── scripts/                # Utility scripts
├── supabase/               # Database migrations and configuration
├── tests/                  # Additional project tests
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

## Documentation

Additional project documentation is available in `docs/`:

- [Requirements](docs/requirements.md)
- [Architecture](docs/architecture.md)
- [API](docs/api.md)
- [Database Schema](docs/database-schema.md)
- [Security](docs/security.md)
- [Deep Learning](docs/deep-learning.md)
- [Models](docs/models.md)
- [Project Status](docs/project-status.md)
- [Final Review](docs/final-review.md)
- [Cloudflare Deployment](docs/cloudflare-deployment.md)

## Deployment Status

The application includes Cloudflare/OpenNext deployment configuration.

The real FastAPI model inference pipeline has been integrated and tested in the local development environment. The production Cloudflare deployment does not yet include the real model service endpoint.

Therefore, local real-model inference and production model deployment are separate milestones. A successful local prediction does not establish that real model inference is available in production.

## Security and Data Handling

- Environment files containing secrets must never be committed.
- Model checkpoints must remain outside the Git repository.
- Local virtual environments and generated build artifacts are excluded.
- Database access is governed by Supabase authentication and Row Level Security policies.
- Uploaded plant photographs may contain user-generated data and should be handled accordingly.

## Project Status

AgriTech is an academic and technical prototype under active development.

The repository documents the application architecture, model integration, dataset preparation, evaluation results, and current deployment limitations.

Further work includes field validation, broader image testing, and deployment of the real inference service.

## License

No open-source license has been assigned yet. All third-party datasets, images, and dependencies remain subject to their respective terms and licenses.
