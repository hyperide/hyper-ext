# Kubernetes Deployment

## Critical Rule

**NEVER apply `k8s/base` directly** — base contains placeholder values (e.g., `hypercanvas.example.com`).
Always use overlays:

```bash
# WRONG — will break ingress!
kustomize build k8s/base | kubectl apply -f -

# CORRECT
kustomize build k8s/overlays/production --enable-alpha-plugins | kubectl apply -f -
```

Production overlay patches placeholders with actual values (`hyperi.de`).

## Environments

| Namespace                      | Purpose                           |
| ------------------------------ | --------------------------------- |
| `hypercanvas`                  | Production app (backend+frontend) |
| `hypercanvas-agents`           | Production AI agents              |
| `hypercanvas-projects`         | Production user project pods      |
| `hypercanvas-staging`          | Staging app                       |
| `hypercanvas-staging-agents`   | Staging AI agents                 |
| `hypercanvas-staging-projects` | Staging user projects             |

## Common Commands

```bash
# Production
kubectl get pods -n hypercanvas
kubectl logs -n hypercanvas deployment/hypercanvas --tail=100

# Staging
kubectl get pods -n hypercanvas-staging
kubectl logs -n hypercanvas-staging deployment/hypercanvas --tail=100

# Project pod status
kubectl get pods -n hypercanvas-staging -l hypercanvas.io/project-id=PROJECT_ID

# Project Service
kubectl get svc -n hypercanvas-staging -l hypercanvas.io/project-id=PROJECT_ID

# Fix stuck project status
kubectl exec -n hypercanvas-staging postgres-0 -- psql -U hypercanvas -d hypercanvas -c \
  "UPDATE projects SET status = 'running' WHERE id = 'PROJECT_ID';"
```

## Bootstrap

For fresh cluster setup: `./k8s/bootstrap.sh`

For manual steps and troubleshooting: see `k8s/RUNBOOK.md`

## Database Migrations in K8s

Run automatically via init containers on every deployment.
See `database-and-migrations` memory for full workflow.
