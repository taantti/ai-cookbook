# Eval report

- Source log: `eval-hallucination-1785082162793.log`
- Runs: 115
- Notional cost: $2.8661
- Generated: 2026-07-26T17:57:02.682Z

## Conclusion

Lowest hallucination rate: `A-rules` (0/70, true rate ≤ 4.3%). Highest: `B-norules` (8/35, 22.9% observed).

## Summary

- **A-rules**: 0/70 → 0.0% observed, true rate ≤ 4.3% (95% upper bound, rule of three) (5 ERROR excluded)
- **B-norules**: 8/35 → 22.9% observed (5 ERROR excluded)

| Variant | Case | PASS | FAIL | ERROR | Gradeable | Halluc-% |
|---|---|---|---|---|---|---|
| A-rules | coldStorageZone | 15 | 0 | 0 | 15 | 0.0% |
| A-rules | deliveryTruck | 15 | 0 | 0 | 15 | 0.0% |
| A-rules | loyaltyProgram | 15 | 0 | 0 | 15 | 0.0% |
| A-rules | qualityInspection | 10 | 0 | 5 | 10 | 0.0% |
| A-rules | zzyzx | 15 | 0 | 0 | 15 | 0.0% |
| A-rules | **total** | 70 | 0 | 5 | 70 | 0.0% |
| B-norules | coldStorageZone | 6 | 2 | 0 | 8 | 25.0% |
| B-norules | deliveryTruck | 7 | 1 | 0 | 8 | 12.5% |
| B-norules | loyaltyProgram | 4 | 4 | 0 | 8 | 50.0% |
| B-norules | qualityInspection | 2 | 1 | 5 | 3 | 33.3% |
| B-norules | zzyzx | 8 | 0 | 0 | 8 | 0.0% |
| B-norules | **total** | 27 | 8 | 5 | 35 | 22.9% |