const DIGEST = /^sha256:[0-9a-f]{64}$/;

/**
 * ECS resolves a task definition's tagged ECR image to a digest before the task
 * starts. The ECR digest currently associated with the approved immutable tag is
 * therefore the authoritative provenance comparison, not the rendered image URI.
 */
export function matchesImmutableRuntimeImage({expectedDigest, runningDigest}) {
  return typeof expectedDigest === 'string'
    && typeof runningDigest === 'string'
    && DIGEST.test(expectedDigest)
    && expectedDigest === runningDigest;
}
