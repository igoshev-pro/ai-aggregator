"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseProvider = void 0;
class BaseProvider {
    constructor(slug, config) {
        this.slug = slug;
        this.config = config;
    }
    getSlug() {
        return this.slug;
    }
    getHeaders() {
        return {
            'Content-Type': 'application/json',
            ...this.config.headers,
        };
    }
}
exports.BaseProvider = BaseProvider;
//# sourceMappingURL=base-provider.abstract.js.map