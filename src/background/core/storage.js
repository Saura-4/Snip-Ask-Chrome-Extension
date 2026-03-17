export function getStorage(keys) {
    return new Promise((resolve) => {
        try {
            chrome.storage.local.get(keys, (items) => resolve(items || {}));
        } catch (error) {
            resolve({});
        }
    });
}
