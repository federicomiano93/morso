// Minimal GitHub REST client for the private data repo (contents API).
// The token is only ever put in the Authorization header: never in a URL, a message or a log.

const API = 'https://api.github.com';

export class GitHubError extends Error {
  /** kind: auth | forbidden | notfound | conflict | ratelimit | network | server | other */
  constructor(kind, message, status = 0) {
    super(message);
    this.name = 'GitHubError';
    this.kind = kind;
    this.status = status;
  }
}

export function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function fromBase64(b64) {
  const bin = atob(String(b64).replace(/\s/g, ''));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

const encodePath = (p) => p.split('/').map(encodeURIComponent).join('/');

function classify(status, body, headers) {
  const msg = body && body.message ? String(body.message) : '';
  if (status === 401) {
    return new GitHubError('auth', 'GitHub rejected the token. It may have expired: create a new one in Settings.', status);
  }
  if (status === 403 || status === 429) {
    const remaining = headers && headers.get && headers.get('x-ratelimit-remaining');
    if (status === 429 || remaining === '0' || /rate limit/i.test(msg)) {
      return new GitHubError('ratelimit', 'GitHub is limiting requests for now. Morso will retry later.', status);
    }
    return new GitHubError('forbidden', 'The token is not allowed to do this. It needs Contents: read and write on morso-data.', status);
  }
  if (status === 404) return new GitHubError('notfound', 'Not found on GitHub.', status);
  if (status === 409 || status === 422) return new GitHubError('conflict', 'The file changed on GitHub in the meantime.', status);
  if (status >= 500) return new GitHubError('server', 'GitHub had a problem. Morso will retry later.', status);
  return new GitHubError('other', `GitHub answered with an unexpected error (${status}).`, status);
}

/**
 * @param {{ token: string, repo: string, fetchImpl?: typeof fetch }} opts  repo is "owner/name"
 */
export function createGitHub({ token, repo, fetchImpl = globalThis.fetch }) {
  async function call(method, path, body) {
    let res;
    try {
      res = await fetchImpl(`${API}${path}`, {
        method,
        cache: 'no-store',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new GitHubError('network', 'No connection to GitHub. Your changes are saved on this phone and will sync later.');
    }
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (!res.ok) throw classify(res.status, data, res.headers);
    return data;
  }

  const contentsPath = (p) => `/repos/${repo}/contents/${encodePath(p)}`;

  return {
    /** Checks that the token can reach the repo; resolves with the repo's full name. */
    async check() {
      const r = await call('GET', `/repos/${repo}`);
      const canWrite = !r.permissions || r.permissions.push !== false;
      if (!canWrite) throw new GitHubError('forbidden', 'The token can read morso-data but not write to it.', 403);
      return r.full_name;
    },

    /** Resolves with { text, sha } or null when the file does not exist. */
    async getFile(path) {
      try {
        const r = await call('GET', contentsPath(path));
        if (Array.isArray(r) || r.type !== 'file') return null;
        return { text: fromBase64(r.content || ''), sha: r.sha };
      } catch (err) {
        if (err.kind === 'notfound') return null;
        throw err;
      }
    },

    /** Resolves with the new blob sha. `sha` is null when creating a file. */
    async putFile(path, text, sha, message) {
      const r = await call('PUT', contentsPath(path), {
        message,
        content: toBase64(text),
        ...(sha ? { sha } : {}),
      });
      return r.content.sha;
    },

    async deleteFile(path, sha, message) {
      await call('DELETE', contentsPath(path), { message, sha });
    },

    /** Resolves with [{ name, path, sha }] for the files in a folder; [] when it does not exist. */
    async listDir(path) {
      try {
        const r = await call('GET', contentsPath(path));
        if (!Array.isArray(r)) return [];
        return r.filter((x) => x.type === 'file').map((x) => ({ name: x.name, path: x.path, sha: x.sha }));
      } catch (err) {
        if (err.kind === 'notfound') return [];
        throw err;
      }
    },
  };
}
