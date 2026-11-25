# Contributing to Feast Mode

Thanks for helping. Keep changes small and dependency-light.

## Setup

```bash
npm install
```

```bash
npm run dev
```

## Before you open a pull request

Run the checks:

```bash
npm test
```

```bash
npm run typecheck
```

- **New or changed plans** must pass the plan checker:

  ```bash
  npm run check-plan -- plans/your-plan.json
  ```

- **UI changes** need a screenshot or short recording in the pull request description.

## Holiday example plans

Pull requests that add example plans are welcome. Keep them realistic: sensible timings, device use that matches the real cooking, and recipes you have the right to share. Do not copy recipes from copyrighted books or sites unless the license allows it. Your own recipes or public-domain ones are best.

Put the file in `plans/`, follow [docs/PLAN_FORMAT.md](docs/PLAN_FORMAT.md), and mention in the pull request what is assumed.

## Code guidelines

- Keep the scheduling logic in `src/engine/` pure, with no React or browser APIs, so it stays testable.
- Do not add a runtime dependency without a clear reason.
- Add or update tests for behavior changes.
