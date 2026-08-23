# Contributing to Free Proxy Checker

Thank you for your interest in contributing to **Free Proxy Checker**! We welcome bug reports, feature requests, documentation improvements, and code contributions.

---

## 🛠️ Development Setup

### Prerequisites
- [Bun](https://bun.sh) (v1.2 or higher)
- Git

### Getting Started

1. **Fork and clone the repository:**
   ```bash
   git clone https://github.com/<your-username>/free-proxy-checker.git
   cd free-proxy-checker
   ```

2. **Install dependencies:**
   ```bash
   bun install
   ```

3. **Start development server with live reload:**
   ```bash
   bun run dev
   ```

4. **Verify TypeScript types:**
   ```bash
   bun run typecheck
   ```

---

## 📋 Contribution Workflow

1. **Create a branch**:
   ```bash
   git checkout -b feature/your-feature-name
   # or
   git checkout -b fix/your-bug-fix
   ```

2. **Make your changes**:
   - Write clean, modern TypeScript code.
   - Follow existing patterns in `src/`.
   - Ensure the server runs without errors.
   - Ensure type check passes (`bun run typecheck`).

3. **Commit your changes**:
   - Use clear, conventional commit messages:
     - `feat: add new proxy source format parser`
     - `fix: resolve socket timeout leak`
     - `docs: update API documentation`

4. **Push and create a Pull Request (PR)**:
   ```bash
   git push origin feature/your-feature-name
   ```
   - Open a PR against the `main` branch.
   - Fill out the PR template thoroughly.

---

## 📜 Code Style & Standards

- **Runtime**: Always use Bun native features (e.g., `bun:sqlite`, `Bun.serve()`).
- **No Fallback Standard**: Avoid loose fallback chains. Fail fast and cleanly handle errors.
- **Safety**: Do not commit any sensitive credentials, tokens, or personal proxy lists with private authentication.

---

## 💬 Community & Questions

Feel free to open an Issue for any questions or discussions regarding architectural proposals and feature ideas.
