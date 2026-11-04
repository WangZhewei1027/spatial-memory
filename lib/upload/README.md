# 文件上传模块

`policy.ts` 定义前后端共享的原文件和存储上限，`detection.ts` 定义类型识别。浏览器的 `FileUploadService.processFile` 只校验原文件并读取 EXIF GPS，不压缩或解码音频。

`request.server.ts` 限制 multipart 请求体，`media-processing.server.ts` 在团队授权后使用 sharp 压缩图片、FFmpeg 转码 MP3 音频与 H.264/AAC MP4 视频。处理后的字节用于 OSS、hash 和上传回执。业务提交由 `app/manage/lib/content-upload.ts` 连接回执和当前素材内容。

完整流程统一见 [素材上传与编辑](../../docs/asset-pipeline.md)，文件复用与回收见 [存储生命周期](../../docs/asset-storage-lifecycle.md)。
