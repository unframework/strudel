#!/usr/bin/env python3
"""Restack nm/* branches onto upstream/main.

Usage:
    python3 restack.py [prefix]

If no prefix given, generates tmp/YYYYMMDD. Pass an existing prefix to resume.
"""

import atexit
import subprocess
import sys
import tempfile
from datetime import date

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

UPSTREAM_REMOTE = "upstream"  # use "origin" for testing
UPSTREAM_BRANCH = "main"

REPLAY = [
    ("rebase", "nm/restack"),
    ("rebase", "nm/viewing-id-init"),
    ("rebase", "nm/midi-buttons"),
    ("rebase", "nm/claude"),

    ("forward",),
    ("rebase", "nm/deploy"),
    ("rebase", "nm/midi-widget"),
    ("rebase", "nm/cm-remote"),
    ("rebase", "nm/dattorro"),
    ("rebase", "nm/supasync"),

    ("forward",),
    ("rebase", "nm/record"),
]

PUSH_BRANCHES = [s[1] for s in REPLAY if s[0] == "rebase"]

# ---------------------------------------------------------------------------
# Git helpers
# ---------------------------------------------------------------------------

def git(*args, check=True, capture=True):
    """Run a git command in the main repo."""
    cmd = ["git"] + list(args)
    if capture:
        r = subprocess.run(cmd, capture_output=True, text=True, check=check)
        return r.stdout.strip()
    else:
        subprocess.run(cmd, check=check)
        return None


def git_wt(worktree, *args, check=True, capture=True):
    """Run a git command in the worktree."""
    cmd = ["git", "-C", worktree] + list(args)
    if capture:
        r = subprocess.run(cmd, capture_output=True, text=True, check=check)
        return r.stdout.strip()
    else:
        subprocess.run(cmd, check=check)
        return None


def ref_exists(ref):
    """Check if a git ref exists."""
    r = subprocess.run(
        ["git", "rev-parse", "--verify", f"refs/heads/{ref}"],
        capture_output=True, text=True,
    )
    return r.returncode == 0


def resolve(ref):
    """Resolve a ref to a SHA."""
    return git("rev-parse", ref)


def short_sha(sha):
    return sha[:10]


# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------

def preflight(resuming=False):
    # Clean working tree
    r = subprocess.run(
        ["git", "diff", "--quiet"], capture_output=True
    )
    r2 = subprocess.run(
        ["git", "diff", "--cached", "--quiet"], capture_output=True
    )
    if r.returncode != 0 or r2.returncode != 0:
        print("ERROR: Working tree is not clean. Commit or stash first.")
        sys.exit(1)

    if not resuming:
        # Verify all branches pushed to origin
        for branch in PUSH_BRANCHES:
            local_r = subprocess.run(
                ["git", "rev-parse", branch],
                capture_output=True, text=True,
            )
            if local_r.returncode != 0:
                # Branch doesn't exist locally, check if it exists on origin
                remote_r = subprocess.run(
                    ["git", "rev-parse", f"origin/{branch}"],
                    capture_output=True, text=True,
                )
                if remote_r.returncode != 0:
                    print(f"ERROR: {branch} not found locally or on origin")
                    sys.exit(1)
                # Only on origin, that's fine
                continue

            local_sha = local_r.stdout.strip()
            remote_r = subprocess.run(
                ["git", "rev-parse", f"origin/{branch}"],
                capture_output=True, text=True,
            )
            if remote_r.returncode != 0:
                print(f"ERROR: {branch} has no origin/{branch}. Push it first.")
                sys.exit(1)
            remote_sha = remote_r.stdout.strip()
            if local_sha != remote_sha:
                print(f"ERROR: {branch} differs from origin/{branch}. Push first.")
                sys.exit(1)

        # Fetch upstream
        print(f"Fetching {UPSTREAM_REMOTE}...")
        git("fetch", UPSTREAM_REMOTE, capture=False)
    else:
        # On resume, try to fetch but don't fail
        print(f"Fetching {UPSTREAM_REMOTE} (optional on resume)...")
        r = subprocess.run(
            ["git", "fetch", UPSTREAM_REMOTE],
            capture_output=True, text=True,
        )
        if r.returncode != 0:
            print(f"  Warning: fetch failed, using cached refs")

    print()


# ---------------------------------------------------------------------------
# Worktree management
# ---------------------------------------------------------------------------

_worktree_dir = None
_cleanup_enabled = True


def setup_worktree(start_ref):
    global _worktree_dir
    _worktree_dir = tempfile.mkdtemp(prefix="restack-wt-")
    git("worktree", "add", "--detach", _worktree_dir, start_ref, capture=False)
    print(f"Worktree: {_worktree_dir}\n")
    return _worktree_dir


def cleanup_worktree():
    if not _cleanup_enabled or _worktree_dir is None:
        return
    subprocess.run(
        ["git", "worktree", "remove", "--force", _worktree_dir],
        capture_output=True,
    )
    print("Cleaned up worktree.")


atexit.register(cleanup_worktree)


def disable_cleanup():
    global _cleanup_enabled
    _cleanup_enabled = False


# ---------------------------------------------------------------------------
# Core operations
# ---------------------------------------------------------------------------

def find_fork_info(branch):
    """Auto-detect the fork point for a branch by scanning its history.

    Walks up to 50 commits back from origin/<branch> looking for:
    1. A commit that another origin/nm/* or origin/main points at
    2. A merge commit

    Returns (parent_branch_or_none, fork_sha).
    parent_branch is e.g. "nm/deploy" or "main", or None if a merge was found.
    """
    # Build map of SHA -> branch name for all potential parents
    tips = {}

    # All origin/nm/* branches
    refs_output = git(
        "for-each-ref", "refs/remotes/origin/nm/",
        "--format=%(objectname) %(refname:lstrip=3)",
    )
    for line in refs_output.split("\n"):
        if not line.strip():
            continue
        sha, name = line.split(" ", 1)
        if name != branch:
            tips[sha] = name

    # origin/main (and upstream/main if different)
    for remote_branch in [f"origin/{UPSTREAM_BRANCH}", f"{UPSTREAM_REMOTE}/{UPSTREAM_BRANCH}"]:
        r = subprocess.run(
            ["git", "rev-parse", remote_branch],
            capture_output=True, text=True,
        )
        if r.returncode == 0:
            tips[r.stdout.strip()] = "main"

    # Walk the branch log
    log_output = git("log", "--format=%H %P", "-50", f"origin/{branch}")
    first = True
    for line in log_output.split("\n"):
        if not line.strip():
            continue
        parts = line.split()
        commit_sha = parts[0]
        parent_shas = parts[1:]

        # Skip the tip itself (that's our own branch)
        if first:
            first = False
            # But still check if the tip IS another branch (degenerate case)
            if commit_sha in tips:
                return tips[commit_sha], commit_sha
            continue

        # Check if this commit is a known branch tip
        if commit_sha in tips:
            return tips[commit_sha], commit_sha

        # Check if this is a merge commit
        if len(parent_shas) > 1:
            return None, commit_sha

    # Fallback: merge-base with upstream
    upstream_ref = f"{UPSTREAM_REMOTE}/{UPSTREAM_BRANCH}"
    mb = git("merge-base", f"origin/{branch}", upstream_ref)
    return "main", mb


def get_unique_commits(branch, fork_sha):
    """Get non-merge commits unique to branch beyond fork_sha."""
    out = git(
        "rev-list", "--reverse", "--no-merges",
        f"origin/{branch}", "--not", fork_sha,
    )
    if not out:
        return []
    return out.split("\n")


def do_cherry_pick(wt, branch, commits, base_sha, prefix):
    """Cherry-pick commits onto base_sha, save as prefix/branch."""
    ref_name = f"{prefix}/{branch}"

    if ref_exists(ref_name):
        result_sha = resolve(ref_name)
        count = len(commits) if commits else "?"
        print(f"  SKIP {branch} (already at {short_sha(result_sha)}, {count} commits)")
        return result_sha

    if not commits:
        print(f"  SKIP {branch} (no unique commits)")
        git("branch", "-f", ref_name, base_sha)
        return base_sha

    print(f"  Replaying {len(commits)} commits from {branch}...")

    git_wt(wt, "checkout", "--detach", base_sha)

    for i, sha in enumerate(commits):
        subject = git("log", "--format=%s", "-1", sha)
        r = subprocess.run(
            ["git", "-C", wt, "cherry-pick", sha],
            capture_output=True, text=True,
        )
        if r.returncode != 0:
            print(f"\n  !!! CONFLICT at commit {i+1}/{len(commits)}: {short_sha(sha)} {subject}")
            print(f"  Resolve in: {wt}")
            print(f"  Then: git -C {wt} cherry-pick --continue")
            print(f"  Then save:  git branch -f {ref_name} $(git -C {wt} rev-parse HEAD)")
            print(f"  Then rerun: python3 restack.py {prefix}")
            disable_cleanup()
            sys.exit(1)

        if (i + 1) % 10 == 0:
            print(f"    ...{i+1}/{len(commits)}")

    result_sha = git_wt(wt, "rev-parse", "HEAD")
    git("branch", "-f", ref_name, result_sha)
    print(f"  Saved {ref_name} -> {short_sha(result_sha)}")
    return result_sha


def do_merge(wt, ref_name, head_sha, message):
    """Merge ref_name into head_sha, return new head."""
    merge_sha = resolve(ref_name)

    # Fast-forward case
    mb = git("merge-base", head_sha, merge_sha)
    # if mb == head_sha:
    #     # head is ancestor of merge target, just fast-forward
    #     return merge_sha

    if mb == merge_sha:
        # Already contained, nothing to do
        return head_sha

    # Real merge
    git_wt(wt, "checkout", "--detach", head_sha)
    r = subprocess.run(
        ["git", "-C", wt, "merge", "--no-ff", "--no-edit",
         "-m", message, merge_sha],
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        print(f"\n  !!! MERGE CONFLICT merging {ref_name} into HEAD")
        print(f"  Resolve in: {wt}")
        print(f"  Then: git -C {wt} merge --continue")
        disable_cleanup()
        sys.exit(1)

    return git_wt(wt, "rev-parse", "HEAD")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    # Parse prefix
    resuming = False
    if len(sys.argv) > 1:
        prefix = sys.argv[1]
        resuming = True
        print(f"Resuming with prefix: {prefix}")
    else:
        prefix = f"tmp/{date.today().strftime('%Y%m%d')}"
        # Check for collision
        if ref_exists(f"{prefix}/main"):
            print(f"ERROR: {prefix}/ refs already exist. Pass the prefix explicitly to resume:")
            print(f"  python3 restack.py {prefix}")
            sys.exit(1)
        print(f"New restack: {prefix}")

    print()
    preflight(resuming=resuming)

    # Store upstream/main snapshot
    upstream_sha = resolve(f"{UPSTREAM_REMOTE}/{UPSTREAM_BRANCH}")
    git("branch", "-f", f"{prefix}/main", upstream_sha)
    print(f"upstream/main: {short_sha(upstream_sha)}")

    # Setup worktree
    wt = setup_worktree(upstream_sha)

    base_sha = upstream_sha
    head_sha = upstream_sha

    for step in REPLAY:
        cmd = step[0]

        if cmd == "forward":
            base_sha = head_sha
            print(f"\n>> forward: base = {short_sha(base_sha)}")
            continue

        if cmd == "rebase":
            branch = step[1]

            # Auto-detect fork point by scanning branch history
            parent_branch, fork_sha = find_fork_info(branch)
            fork_desc = parent_branch or "merge"
            print(f"\n>> {branch} (fork: {fork_desc} @ {short_sha(fork_sha)})")

            # Get unique commits beyond the fork point
            commits = get_unique_commits(branch, fork_sha)

            # Determine cherry-pick target: if the parent branch was already
            # rebased in this run, stack on top of it instead of current base.
            pick_onto = base_sha
            # if parent_branch and parent_branch != "main":
            #     parent_ref = f"{prefix}/{parent_branch}"
            #     if ref_exists(parent_ref):
            #         pick_onto = resolve(parent_ref)

            # Cherry-pick onto target
            ref_name = f"{prefix}/{branch}"
            result_sha = do_cherry_pick(wt, branch, commits, pick_onto, prefix)

            # Merge into running head
            head_sha = do_merge(wt, ref_name, head_sha, f"restack: merge {branch}")
            print(f"  HEAD: {short_sha(head_sha)}")
            continue

        print(f"ERROR: Unknown command: {cmd}")
        sys.exit(1)

    # Save final head
    git("branch", "-f", f"{prefix}/head", head_sha)

    # Summary
    print("\n" + "=" * 60)
    print("RESTACK COMPLETE")
    print("=" * 60)
    refs = git("for-each-ref", f"refs/heads/{prefix}/",
               "--format=%(refname:short) %(objectname:short)")
    for line in refs.split("\n"):
        if line:
            print(f"  {line}")
    print(f"\nTo inspect: git log --oneline --graph {prefix}/head {prefix}/main")


if __name__ == "__main__":
    main()
