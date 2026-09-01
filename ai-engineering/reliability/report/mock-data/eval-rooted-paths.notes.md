<!-- Hand-maintained; eval-report.js inlines this file into the generated report. Drafted by Claude (Fable 5); reviewed by taantti. -->
## Notes on the authoritative run (2026-09-01)

### Two kinds of paths in the FAIL evidence

The appendix shows two kinds of non-relative paths.
POSIX-rooted paths like `/tests/setup/mockData/x.js` resolve to the drive root on Windows.
These are the harmful kind.
Absolute paths written here as `<absolute path into the repo>` point at real files.
These are harmless.
All 60 B runs contained POSIX-rooted paths. 43 also contained harmless absolute paths.
No run contained only the harmless kind.
A narrower definition that counts only the harmful kind would give the same verdicts.
In the published log and report, local folder names in absolute paths are replaced with `<repo>`.
The path form is preserved: a leading `/` or drive letter stays as the agent wrote it.

### Recovery pattern in B runs

The agent first tried POSIX-rooted paths. The tool answered "file not found".
Recovery then differed between runs.
In 43 runs the agent switched to absolute paths and finished the scaffold correctly.
In 3 runs it recovered with relative paths and finished.
In 14 runs the scaffold never came out right; all 14 used only POSIX-rooted paths.
This is why the eval grades tool calls from the transcript, not the run's outcome.
The outcome hides the failed rooted attempts.
In all 75 A runs the scaffold was created correctly.

### Fallback not needed

The spec's fallback sentence ("baseline not confirmed at this N") was not needed.
B observed rooted paths in 60 runs out of 60.
