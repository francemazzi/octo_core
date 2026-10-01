export class OctoError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "OctoError";
    this.code = code;
  }
}
