// agent/index.ts — barrel 统一导出
// 外部模块从这里 import，不用关心内部文件拆分

export { runAgent } from './service.js'
export { tools } from './tools.js'
export { CUSTOMER_SERVICE_PROMPT } from './prompt.js'
export { toSdkMessages } from './convert.js'
