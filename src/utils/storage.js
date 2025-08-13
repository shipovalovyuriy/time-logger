// Utility functions for localStorage operations with fallback support

export const storage = {
  // Check if localStorage is available
  isAvailable: () => {
    try {
      const testKey = '__test__';
      localStorage.setItem(testKey, 'test');
      localStorage.removeItem(testKey);
      return true;
    } catch (error) {
      console.error('localStorage is not available:', error);
      return false;
    }
  },

  // Set item with error handling
  setItem: (key, value) => {
    try {
      if (storage.isAvailable()) {
        localStorage.setItem(key, value);
        return true;
      }
      return false;
    } catch (error) {
      console.error(`Failed to set localStorage item ${key}:`, error);
      return false;
    }
  },

  // Get item with error handling
  getItem: (key) => {
    try {
      if (storage.isAvailable()) {
        return localStorage.getItem(key);
      }
      return null;
    } catch (error) {
      console.error(`Failed to get localStorage item ${key}:`, error);
      return null;
    }
  },

  // Remove item with error handling
  removeItem: (key) => {
    try {
      if (storage.isAvailable()) {
        localStorage.removeItem(key);
        return true;
      }
      return false;
    } catch (error) {
      console.error(`Failed to remove localStorage item ${key}:`, error);
      return false;
    }
  },

  // Clear all items with error handling
  clear: () => {
    try {
      if (storage.isAvailable()) {
        localStorage.clear();
        return true;
      }
      return false;
    } catch (error) {
      console.error('Failed to clear localStorage:', error);
      return false;
    }
  },

  // Get all keys
  getKeys: () => {
    try {
      if (storage.isAvailable()) {
        return Object.keys(localStorage);
      }
      return [];
    } catch (error) {
      console.error('Failed to get localStorage keys:', error);
      return [];
    }
  },

  // Get storage info for debugging
  getInfo: () => {
    try {
      if (storage.isAvailable()) {
        return {
          available: true,
          length: localStorage.length,
          keys: Object.keys(localStorage),
          quota: 'unknown' // localStorage quota is not easily accessible
        };
      }
      return {
        available: false,
        length: 0,
        keys: [],
        quota: 'unknown'
      };
    } catch (error) {
      console.error('Failed to get localStorage info:', error);
      return {
        available: false,
        length: 0,
        keys: [],
        quota: 'unknown',
        error: error.message
      };
    }
  }
};

export default storage;
