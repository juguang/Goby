// Goby - AI 浏览器助手 | chrome.storage.local 读写封装
// API Key 仅通过此模块访问 chrome.storage.local，不经过 postMessage（SEC-03）
//
// Plan 01-02: 多 Profile CRUD 重构
// 数据结构（chrome.storage.local key: "agentConfig"）:
//   {
//     "profiles": { "profileName": {baseUrl, apiKey, model} },
//     "activeProfile": "profileName",
//     "autoStart": false
//   }

(function () {
  /**
   * 从 storage 读取完整 agentConfig 对象
   * @returns {Promise<Object>}
   */
  function readConfig() {
    return chrome.storage.local.get(['agentConfig']).then(function (result) {
      return result.agentConfig || {};
    });
  }

  /**
   * 完整写入 agentConfig 到 storage
   * @param {Object} config
   * @returns {Promise<void>}
   */
  function writeConfig(config) {
    return chrome.storage.local.set({ agentConfig: config });
  }

  /**
   * 检测数据是否为旧格式（顶层 baseUrl/apiKey/model，无 profiles 键）
   * @param {Object} config
   * @returns {boolean}
   */
  function isOldFormat(config) {
    return (
      config &&
      !config.profiles &&
      typeof config.baseUrl === 'string' &&
      typeof config.apiKey === 'string' &&
      typeof config.model === 'string'
    );
  }

  /**
   * 将旧格式数据迁移为新格式
   * @param {Object} oldConfig
   * @returns {Object} 新格式配置
   */
  function migrateOldFormat(oldConfig) {
    return {
      profiles: {
        '默认配置': {
          baseUrl: oldConfig.baseUrl || '',
          apiKey: oldConfig.apiKey || '',
          model: oldConfig.model || ''
        }
      },
      activeProfile: '默认配置',
      autoStart: oldConfig.autoStart === true
    };
  }

  var GobyStorage = {

    // ---- 新多 Profile API (Plan 01-02) ----

    /**
     * 获取所有 API 配置 Profile
     * 首次调用时自动检测旧格式数据并迁移
     * @returns {Promise<Object>} { profileName: {baseUrl, apiKey, model}, ... }
     */
    getProfiles: function () {
      return readConfig().then(function (config) {
        // 旧格式 → 自动迁移
        if (isOldFormat(config)) {
          var migrated = migrateOldFormat(config);
          return writeConfig(migrated).then(function () {
            GobyStorage._profilesCache = migrated.profiles || {};
            return GobyStorage._profilesCache;
          });
        }
        GobyStorage._profilesCache = config.profiles || {};
        return GobyStorage._profilesCache;
      });
    },

    /**
     * 保存/更新一个 API 配置 Profile
     * 若当前无 activeProfile，自动设为该 profile
     * @param {string} name - Profile 名称
     * @param {{baseUrl: string, apiKey: string, model: string}} profileConfig
     * @returns {Promise<void>}
     */
    saveProfile: function (name, profileConfig) {
      return readConfig().then(function (config) {
        // 确保新格式
        if (isOldFormat(config)) {
          config = migrateOldFormat(config);
        }
        if (!config.profiles) {
          config.profiles = {};
        }
        config.profiles[name] = {
          baseUrl: profileConfig.baseUrl || '',
          apiKey: profileConfig.apiKey || '',
          model: profileConfig.model || ''
        };
        // 若尚无 activeProfile，自动设为该 profile
        if (!config.activeProfile) {
          config.activeProfile = name;
        }
        if (config.autoStart === undefined) {
          config.autoStart = false;
        }
        return writeConfig(config);
      }).then(function () {
        // 刷新内部缓存
        return readConfig().then(function (config) {
          GobyStorage._profilesCache = config.profiles || {};
        });
      });
    },

    /**
     * 删除指定的 API 配置 Profile
     * 若删除的是当前 activeProfile，自动切换到剩余第一个或设为空字符串
     * @param {string} name - Profile 名称
     * @returns {Promise<Object>} 更新后的 profiles 对象
     */
    deleteProfile: function (name) {
      return readConfig().then(function (config) {
        if (!config.profiles) {
          config.profiles = {};
        }
        delete config.profiles[name];

        // 若删除的是 activeProfile，自动切换
        if (config.activeProfile === name) {
          var remaining = Object.keys(config.profiles);
          config.activeProfile = remaining.length > 0 ? remaining[0] : '';
        }

        return writeConfig(config).then(function () {
          GobyStorage._profilesCache = config.profiles;
          return config.profiles;
        });
      });
    },

    /**
     * 设置当前激活的 API 配置 Profile
     * @param {string} name - Profile 名称
     * @returns {Promise<void>} 若 name 不存在则 reject
     */
    setActiveProfile: function (name) {
      return readConfig().then(function (config) {
        if (!config.profiles || !config.profiles[name]) {
          return Promise.reject(new Error('Profile "' + name + '" 不存在'));
        }
        config.activeProfile = name;
        return writeConfig(config);
      });
    },

    /**
     * 获取当前激活的 Profile 名称
     * @returns {Promise<string>} active profile 名称，未设置时返回 ''
     */
    getActiveProfile: function () {
      return readConfig().then(function (config) {
        // 旧格式迁移后获取
        if (isOldFormat(config)) {
          var migrated = migrateOldFormat(config);
          return writeConfig(migrated).then(function () {
            return migrated.activeProfile || '';
          });
        }
        return config.activeProfile || '';
      });
    },

    /**
     * 同步检查指定 Profile 是否存在
     * 注意：数据必须已加载（调用过 getProfiles 等异步方法后使用）
     * 返回结果基于当前内存/缓存，适用于 UI 校验
     * @param {string} name
     * @returns {boolean}
     */
    profileExists: function (name) {
      // 同步检查 — 依赖调用者已通过 getProfiles 等方法缓存数据
      // 这里通过异步读取然后立即判断，但由于 chrome.storage 是异步的，
      // 实际用缓存方式：直接从当前写入过的配置快照判断
      // 为实现同步接口，采用传入快照方式的简化实现
      // 因为 profileExists 主要被 UI 验证使用，在调用链中已有 profiles 数据
      // 这里返回 false，由调用者自己做缓存判断
      // 实际上我们会维护一个内部缓存
      return !!GobyStorage._profilesCache && !!GobyStorage._profilesCache[name];
    },

    // 内部缓存（供 profileExists 使用）
    _profilesCache: null,

    // ---- 旧 API 保留（Plan 01-01 向后兼容） ----

    /**
     * 保存 API 配置（旧接口，保留向后兼容）
     * 内部调用 saveProfile("默认配置", config)
     * @param {{baseUrl: string, apiKey: string, model: string}} config
     * @returns {Promise<void>}
     */
    saveConfig: function (config) {
      return GobyStorage.saveProfile('默认配置', config);
    },

    /**
     * 读取当前激活的 API 配置（旧接口，保留向后兼容）
     * 内部调用 getActiveProfile() 并返回配置对象
     * @returns {Promise<{baseUrl: string, apiKey: string, model: string}>}
     */
    getConfig: function () {
      return readConfig().then(function (config) {
        // 旧格式 → 直接返回
        if (config && typeof config.baseUrl === 'string') {
          return {
            baseUrl: config.baseUrl || '',
            apiKey: config.apiKey || '',
            model: config.model || ''
          };
        }
        // 新格式 → 从 activeProfile 读取
        var activeName = config.activeProfile;
        if (activeName && config.profiles && config.profiles[activeName]) {
          var activeConfig = config.profiles[activeName];
          return {
            baseUrl: activeConfig.baseUrl || '',
            apiKey: activeConfig.apiKey || '',
            model: activeConfig.model || ''
          };
        }
        return {
          baseUrl: '',
          apiKey: '',
          model: ''
        };
      });
    },

    // ---- Skills 管理 (Plan 09-01) ----

    /**
     * 保存一个 Skill Manifest（按 domain 索引到 gobySkills 键）
     * @param {string} domain - 技能适用的域名（如 'amazon.com'）
     * @param {{name: string, description: string, domain: string, actions: Array}} skillManifest
     * @returns {Promise<void>}
     */
    saveSkill: function (domain, skillManifest) {
      return chrome.storage.local.get(['gobySkills']).then(function (result) {
        var skills = result.gobySkills || {};
        skills[domain] = {
          name: skillManifest.name || '',
          description: skillManifest.description || '',
          domain: skillManifest.domain || domain,
          actions: skillManifest.actions || [],
          installedAt: skillManifest.installedAt || Date.now(),
          source: skillManifest.source || '',
          enabled: skillManifest.enabled !== undefined ? skillManifest.enabled : true
        };
        return chrome.storage.local.set({ gobySkills: skills });
      });
    },

    /**
     * 按 domain 获取单个技能
     * @param {string} domain
     * @returns {Promise<Object|null>}
     */
    getSkill: function (domain) {
      return chrome.storage.local.get(['gobySkills']).then(function (result) {
        var skills = result.gobySkills || {};
        return skills[domain] || null;
      });
    },

    /**
     * 获取所有已安装技能
     * @returns {Promise<Object>} { domain: skillManifest, ... }
     */
    getAllSkills: function () {
      return chrome.storage.local.get(['gobySkills']).then(function (result) {
        return result.gobySkills || {};
      });
    },

    /**
     * 切换技能的 enabled 状态
     * @param {string} domain
     * @param {boolean} enabled
     * @returns {Promise<boolean>} true 如果更新成功，false 如果技能不存在
     */
    toggleSkill: function (domain, enabled) {
      return chrome.storage.local.get(['gobySkills']).then(function (result) {
        var skills = result.gobySkills || {};
        if (!skills[domain]) return false;
        skills[domain].enabled = enabled;
        return chrome.storage.local.set({ gobySkills: skills }).then(function () {
          return true;
        });
      });
    },

    /**
     * 按 domain 删除技能
     * @param {string} domain
     * @returns {Promise<boolean>} true 如果删除成功，false 如果技能不存在
     */
    deleteSkill: function (domain) {
      return chrome.storage.local.get(['gobySkills']).then(function (result) {
        var skills = result.gobySkills || {};
        if (!skills[domain]) return false;
        delete skills[domain];
        return chrome.storage.local.set({ gobySkills: skills }).then(function () {
          return true;
        });
      });
    }
  };

  // 暴露到全局（浏览器扩展弹窗和 Jest 测试）
  if (typeof window !== 'undefined') {
    window.GobyStorage = GobyStorage;
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.GobyStorage = GobyStorage;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = GobyStorage;
  }
})();
