/**
 * Validate an existing checkout. This slice never creates or deletes a
 * worktree, branch, or directory.
 */
import { lstatSync, realpathSync } from "node:fs";
import { basename, isAbsolute, relative, sep } from "node:path";
import { ValidationError } from "../domain/errors.js";

const ID = /^[a-z][a-z0-9]{0,16}_[A-Za-z0-9_-]{1,80}$/;

export function assertObjectId(value: string, field: string): string {
  const trimmed = value.trim();
  if (!ID.test(trimmed)) {
    throw new ValidationError(`${field} is invalid.`, { field });
  }
  return trimmed;
}

export interface ReviewedCheckout {
  repositoryRoot: string;
  cwd: string;
  worktreePath?: string;
  displayName: string;
}

function existingDirectory(path: string, field: string): string {
  if (path.includes("\0") || !isAbsolute(path)) {
    throw new ValidationError(`${field} must be an absolute path.`, { field });
  }
  let real: string;
  try {
    const stat = lstatSync(path);
    if (!stat.isDirectory() && !stat.isSymbolicLink()) {
      throw new ValidationError(`${field} must be an existing directory. This slice does not create directories or worktrees.`, { field });
    }
    real = realpathSync(path);
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError(`${field} must be an existing directory. This slice does not create directories or worktrees.`, { field });
  }
  const resolved = lstatSync(real);
  if (!resolved.isDirectory() || resolved.isSymbolicLink()) {
    throw new ValidationError(`${field} must be an existing directory. This slice does not create directories or worktrees.`, { field });
  }
  return real;
}

export function isInsideDirectory(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

export function reviewCheckout(repository: string, worktree: string | undefined): ReviewedCheckout {
  const repositoryRoot = existingDirectory(repository, "repository");
  const displayName = basename(repositoryRoot);
  if (displayName.length === 0 || displayName === "/" || displayName.includes("\0")) {
    throw new ValidationError("Repository display name is empty.", { field: "repository" });
  }
  if (worktree === undefined || worktree.trim().length === 0) {
    return { repositoryRoot, cwd: repositoryRoot, displayName };
  }
  const worktreePath = existingDirectory(worktree, "worktree");
  if (!isInsideDirectory(repositoryRoot, worktreePath)) {
    throw new ValidationError("Worktree must be an existing directory inside the repository. This slice does not create or remove worktrees.", {
      field: "worktree",
    });
  }
  return { repositoryRoot, cwd: worktreePath, worktreePath, displayName };
}
