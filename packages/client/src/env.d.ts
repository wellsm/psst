interface ImportMetaEnv {
  /** Game server (ws:// or wss://) for builds not served by it, e.g. the desktop app. */
  readonly VITE_SERVER_URL?: string;
  /** Base URL of the desktop installers (`Psst-<os>.<ext>`); unset = no download links on the home screen. */
  readonly VITE_DOWNLOAD_URL?: string;
}
