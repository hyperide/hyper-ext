# Security Hardening Guide

This document describes the security architecture and hardening measures for Hypercanvas Kubernetes deployment.

## Threat Model

### Attack Vectors

| Threat | Attack Method | Risk Level |
|--------|---------------|------------|
| Access all user projects | Create deployment mounting PVC without subPath | CRITICAL |
| Read environment variables | `deployments: get` exposes spec with env vars | HIGH |
| Access secrets | Create deployment with secretRef | CRITICAL |
| Delete other projects | `deployments: delete` on any deployment | HIGH |
| Read project logs | `pods/log: get` on any pod | MEDIUM |

### AI Agent vs Main Pod Compromise

| Aspect | Main Pod Compromise | AI Agent in Project Pod |
|--------|---------------------|------------------------|
| Service Account | `hypercanvas-pod-manager` (powerful) | `default` (minimal) |
| PVC Access | All `/app/cloned-projects/` | Only own project (subPath) |
| Secrets | `hypercanvas-secrets` mounted | No secrets |
| K8s API | Full deployment control | Almost none |

**Conclusion:** AI agents are already isolated through subPath. The primary risk is main pod compromise.

## Implemented Mitigations

### 1. RBAC Hardening (Commit: fix(k8s): add services permission)

Removed unused dangerous permissions from `project-pod-manager` Role:

| Removed | Reason |
|---------|--------|
| `pods/exec: create` | Dead code - function never called |
| `pods: create, delete` | Pods managed via Deployments |
| `watch` (everywhere) | No streaming watch operations |
| `pods/log: list` | Only `get` is used |

Added minimal required permissions:
- `services: get, create, delete` - for project DNS
- `deployments/scale: get, patch` - for AI proxy scale-to-zero

### 2. Service Account Token Removal

Added `automountServiceAccountToken: false` to project and IDE pods:
- Prevents K8s API access from user containers
- AI agents cannot interact with cluster

### 3. Kyverno Policies (Commit: feat(k8s): add Kyverno security policies)

#### Prerequisites

Install Kyverno:
```bash
helm repo add kyverno https://kyverno.github.io/kyverno/
helm install kyverno kyverno/kyverno -n kyverno --create-namespace
```

#### Policies

| Policy | Description | Severity |
|--------|-------------|----------|
| `hypercanvas-require-pvc-subpath` | Blocks PVC mount without subPath | HIGH |
| `hypercanvas-deny-secret-mounts` | Blocks secretRef and secret volumes | CRITICAL |
| `hypercanvas-restrict-images` | Only allows `ghcr.io/hyperide/*` | HIGH |
| `hypercanvas-deny-privileged` | Blocks privileged/hostNetwork | CRITICAL |

## Not Implemented (Future Work)

### PVC per Project

**Why not implemented:** Current architecture uses shared PVC with `local-path` provisioner (ReadWriteOnce). Main hypercanvas pod needs access to all project files for editing operations.

**Requirements to implement:**
- NFS or Longhorn with ReadWriteMany storage class
- Significant architecture changes

**Alternative:** Kyverno `require-pvc-subpath` policy blocks the attack vector without changing storage.

### Namespace per User

**Why not implemented:** Overengineering for current scale.

**When to consider:** >1000 users, strict multi-tenancy requirements.

## Verification

### Check RBAC Permissions

```bash
# Test service account permissions
kubectl auth can-i get services -n hypercanvas-staging \
  --as=system:serviceaccount:hypercanvas-staging:hypercanvas-pod-manager

# Should return: yes

kubectl auth can-i create pods -n hypercanvas-staging \
  --as=system:serviceaccount:hypercanvas-staging:hypercanvas-pod-manager

# Should return: no (pods created via Deployments)
```

### Test Kyverno Policies

```bash
# This should FAIL (no subPath)
kubectl apply -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: test-evil-pod
  namespace: hypercanvas-staging
spec:
  containers:
  - name: evil
    image: ghcr.io/hyperide/hypercanvas:latest
    volumeMounts:
    - name: project-storage
      mountPath: /steal-all
  volumes:
  - name: project-storage
    persistentVolumeClaim:
      claimName: hypercanvas-projects-pvc
EOF

# Expected: Error - blocked by hypercanvas-require-pvc-subpath policy
```

## Security Checklist

- [x] Remove unused RBAC permissions
- [x] Add `automountServiceAccountToken: false`
- [x] Kyverno: require subPath for PVC
- [x] Kyverno: deny secret mounts
- [x] Kyverno: restrict images
- [x] Kyverno: deny privileged
- [ ] PVC per project (requires RWX storage)
- [ ] Namespace per user (future)
- [ ] Pod Security Standards labels

## Related Files

- `k8s/base/projects-namespace.yaml` - RBAC Roles
- `k8s/base/kyverno-policies.yaml` - Security policies
- `k8s/base/security-policies.yaml` - NetworkPolicies
- `server/services/k8s-manager.ts` - Pod deployment code
