export class SocialPeerUnavailable extends Error {
  constructor() {
    super("Trusted source session is unavailable or unmapped. Social access is denied.");
  }
}
