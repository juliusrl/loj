# Benchmark Reports

`rdsl-benchmark run` writes versioned JSON and Markdown reports here by default:

```text
benchmarks/reports/YYYY-MM-DD/<run-id>/
```

Each report directory contains:

- `report.json`: machine-readable full report
- `summary.md`: compact human-readable summary
- `failures/`: retained failing `.rdsl` attempts and diagnostics

These report artifacts are intended to be diff-friendly and safe to archive per model/lane run.
