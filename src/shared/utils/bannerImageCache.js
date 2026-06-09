// Populated during the loading screen so BannerCard reads synchronously (no IPC on render).
// Key: `${gameId}:${featuredId}`, value: data URL string.
export const bannerImageCache = new Map();
