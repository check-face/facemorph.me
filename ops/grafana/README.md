# Grafana provisioning for the changeover dashboard

Files provisioned onto triton (`/usr/local/grafana`), which runs Grafana, Prometheus and Loki:

- `dashboards/facemorph-changeover.json`: "FaceMorph before and after" in the folder "FaceMorph changeover
  (public stats)". Read-only in the UI; edit here and copy to
  `/usr/local/grafana/provisioning/dashboards/files/`.
- `provider.yaml`: the dashboard provider, at `/usr/local/grafana/provisioning/dashboards/provider.yaml`
  (mounted into the Grafana container at `/etc/grafana/provisioning`).
- `prometheus-job.yml`: the scrape job appended to `/usr/local/grafana/prometheus.yml`, with the token
  substituted on the host only. Restart Prometheus after changing it.

Mark cutover steps with Grafana annotations tagged `changeover` (they show as red lines on every panel).

`check-dashboard-totals.mjs` (needs docker and `npm ci` in `services/stats`) runs the Worker with and without its
build/host labels in real workerd, scrapes both with a real Prometheus and requires every panel query to give the
same result on both. Rerun it after any change to the Worker's labels or the panel queries.
