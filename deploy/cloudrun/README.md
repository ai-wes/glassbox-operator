Cloud Run deployment (Operator MCP gateway)

Build + push
1) Build image
   docker build -t REGION-docker.pkg.dev/PROJECT_ID/REPO/operator-mcp:TAG -f apps/operator/Dockerfile .

2) Push
   docker push REGION-docker.pkg.dev/PROJECT_ID/REPO/operator-mcp:TAG

Deploy
1) Deploy service
   gcloud run services replace deploy/cloudrun/operator-service.yaml --region REGION

2) Set environment (if not in YAML)
   gcloud run services update operator-mcp \
     --region REGION \
     --set-env-vars OPERATOR_UPSTREAMS_JSON='[...]',OPERATOR_ACTION_MAP_JSON='{}'

Notes
- Cloud Run should serve the Operator HTTP server (apps/operator).
- Avoid apps2/operator-mcp on Cloud Run (stdio-only).
- Use OPERATOR_UPSTREAMS_JSON instead of file mounts.
- Store API keys in Secret Manager and reference them in the service yaml.
