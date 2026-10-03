/**
 * Prod origin of the directioner.com web app (marketing site + browser sign-in).
 * The CLI and Directioner Desktop both send users here for the device-code login
 * flow; sharing the literal keeps their prod defaults from drifting.
 */
export const DIRECTIONER_WEB_URL_PROD = 'https://directioner.com'
