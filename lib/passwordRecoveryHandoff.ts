/** Prevents useDeepLink from yanking the user back to reset-password after handoff. */
let handoffComplete = false;

export function markPasswordRecoveryHandoffComplete(): void {
  handoffComplete = true;
}

export function isPasswordRecoveryHandoffComplete(): boolean {
  return handoffComplete;
}

export function resetPasswordRecoveryHandoffState(): void {
  handoffComplete = false;
}
