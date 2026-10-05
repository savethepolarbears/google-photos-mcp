# Pull Request

## Description

<!-- Describe the "Why" and "What" of your changes -->

### Motivation & Context

### Summary of Changes

## Type of Change

- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] Documentation update
- [ ] Maintenance / chore

## Verification Checklist

Please verify that your PR passes all required checks before requesting review:

- [ ] `npx tsc --noEmit` passes with 0 type errors
- [ ] `npm run lint` passes with 0 ESLint errors
- [ ] `npm run lint:md` passes with 0 markdownlint errors
- [ ] `npm test` passes all unit and integration tests
- [ ] `npx prettier --check "src/**/*.ts"` passes
- [ ] No secrets, tokens, or `.env` files are included in this PR
