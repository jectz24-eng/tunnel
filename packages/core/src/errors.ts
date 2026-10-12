/** An expected, user-facing rejection (bad signature, cycle closed, out of energy…). */
export class ProtocolError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "ProtocolError";
  }
}

export const isProtocolError = (e: unknown): e is ProtocolError => e instanceof ProtocolError;
