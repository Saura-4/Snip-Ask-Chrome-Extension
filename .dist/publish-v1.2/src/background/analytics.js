import { getStorage } from './core/storage.js';
import { getModelProvider, normalizeProviderScopedModelName } from './models/model-routing.js';

const ANALYTICS_BASE_URL = 'https://snip-ask-guest.saurav04042004.workers.dev';
export const PUBLIC_ANALYTICS_URL = `${ANALYTICS_BASE_URL}/analytics/summary`;

async function getAnalyticsInstallId() {
    const storage = await getStorage(['analyticsInstallId']);
    if (storage.analyticsInstallId) {
        return storage.analyticsInstallId;
    }

    const analyticsInstallId = `install-${crypto.randomUUID()}`;
    await chrome.storage.local.set({ analyticsInstallId });
    return analyticsInstallId;
}

export async function trackAnalyticsEvent({ modelName, success, tokenUsage = null }) {
    try {
        const storage = await getStorage(['experimentalAnalyticsOptIn']);
        if (storage.experimentalAnalyticsOptIn !== true || !modelName) {
            return;
        }

        const installId = await getAnalyticsInstallId();
        const payload = {
            installId,
            provider: getModelProvider(modelName),
            model: normalizeProviderScopedModelName(modelName),
            success: success === true,
            tokenCount: tokenUsage?.totalTokens || 0
        };

        await fetch(`${ANALYTICS_BASE_URL}/analytics`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Extension-Id': chrome.runtime.id
            },
            body: JSON.stringify(payload),
            keepalive: true
        });
    } catch (error) {
        console.warn('Analytics tracking skipped:', error);
    }
}
