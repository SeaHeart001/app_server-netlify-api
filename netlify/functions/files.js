const {createHandler, error} = require('../utils');
const {getCurrentWxUser} = require('../utils/wxAuth');

const GITEE_OWNER = 'seaheart1027';
const GITEE_REPO = 'files_block';
const GITEE_BRANCH = 'main';
const GITEE_BASE_URL = 'https://gitee.com/api/v5';
const DEFAULT_DIRECTORY = 'files';
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

const MIME_EXTENSIONS = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif'
};

const FILE_EXTENSIONS = {
    jpg: 'jpg',
    jpeg: 'jpg',
    png: 'png',
    webp: 'webp',
    gif: 'gif'
};

function getRequiredEnv(name) {
    const value = process.env[name];
    if (!value) {
        throw error(500, `服务配置缺少 ${name}`);
    }
    return value;
}

function normalizeBase64(value) {
    const raw = String(value || '').trim();
    if (!raw) {
        throw error(400, '缺少参数: base64');
    }

    return raw
        .replace(/^data:[^;]+;base64,/, '')
        .replace(/\s/g, '');
}

function getImageExtension(body) {
    const contentType = String(body.contentType || body.mimeType || '').toLowerCase();
    if (MIME_EXTENSIONS[contentType]) {
        return MIME_EXTENSIONS[contentType];
    }

    const fileName = String(body.fileName || '').toLowerCase();
    const ext = fileName.split('.').pop();
    if (FILE_EXTENSIONS[ext]) {
        return FILE_EXTENSIONS[ext];
    }

    throw error(400, '仅支持 jpg、png、webp、gif 图片');
}

function decodeImage(body) {
    const base64 = normalizeBase64(body.base64 || body.content || body.data);
    const buffer = Buffer.from(base64, 'base64');

    if (!buffer.length) {
        throw error(400, '图片内容为空');
    }

    if (buffer.length > MAX_IMAGE_BYTES) {
        throw error(413, '图片不能超过 2MB');
    }

    return {base64, buffer};
}

function sanitizeSegment(value) {
    return String(value || '')
        .trim()
        .replace(/[^a-zA-Z0-9_-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

function sanitizeDirectory(value) {
    const parts = String(value || DEFAULT_DIRECTORY)
        .split('/')
        .map(sanitizeSegment)
        .filter(Boolean);

    if (!parts.length) {
        return DEFAULT_DIRECTORY;
    }

    if (parts.length > 5) {
        throw error(400, '目录层级不能超过 5 级');
    }

    return parts.join('/');
}

function getFileBaseName(fileName) {
    const cleanName = String(fileName || '').split('?')[0].split('/').pop() || '';
    const dotIndex = cleanName.lastIndexOf('.');
    return dotIndex > 0 ? cleanName.slice(0, dotIndex) : cleanName;
}

function normalizeNameMode(value) {
    const mode = String(value || 'timestamp').toLowerCase();
    if (mode === 'overwrite' || mode === 'timestamp') {
        return mode;
    }

    throw error(400, 'nameMode 仅支持 timestamp 或 overwrite');
}

function buildTargetPath(body, user, extension) {
    const directory = sanitizeDirectory(body.directory || body.path);
    const userId = sanitizeSegment(user._id || user.id || user.openid);
    const nameMode = normalizeNameMode(body.nameMode || body.mode);
    const rawName = body.name || body.key || getFileBaseName(body.fileName) || 'file';
    const baseName = sanitizeSegment(rawName);

    if (!baseName) {
        throw error(400, '文件名称无效');
    }

    const scopedDirectory = `${directory}/${userId}`;
    const finalName = nameMode === 'overwrite'
        ? `${baseName}.${extension}`
        : `${baseName}-${Date.now()}.${extension}`;

    return {
        directory: scopedDirectory,
        baseName,
        name: finalName,
        nameMode,
        path: `${scopedDirectory}/${finalName}`
    };
}

function buildGiteeUrl(targetPath, params = {}) {
    const encodedPath = targetPath.split('/').map(encodeURIComponent).join('/');
    const url = new URL(`${GITEE_BASE_URL}/repos/${GITEE_OWNER}/${GITEE_REPO}/contents/${encodedPath}`);

    Object.keys(params).forEach(key => {
        if (params[key] !== undefined && params[key] !== null && params[key] !== '') {
            url.searchParams.set(key, params[key]);
        }
    });

    return url.toString();
}

function getGiteeHeaders(extraHeaders = {}) {
    return {
        Authorization: `token ${getRequiredEnv('GITEE_ACCESS_TOKEN')}`,
        ...extraHeaders
    };
}

function buildContentForm(fields) {
    const form = new URLSearchParams();

    Object.keys(fields).forEach(key => {
        if (fields[key] !== undefined && fields[key] !== null && fields[key] !== '') {
            form.set(key, fields[key]);
        }
    });

    return form;
}

async function getGiteeFile(targetPath) {
    const res = await fetch(buildGiteeUrl(targetPath, {ref: GITEE_BRANCH}), {
        headers: getGiteeHeaders()
    });
    const data = await res.json().catch(() => ({}));

    if (res.status === 404) {
        return null;
    }

    if (!res.ok) {
        console.error('Gitee file lookup failed', {
            status: res.status,
            message: data.message,
            path: targetPath
        });
        throw error(502, data.message || 'Gitee 文件查询失败');
    }

    return data;
}

async function listGiteeDirectory(directory) {
    const res = await fetch(buildGiteeUrl(directory, {ref: GITEE_BRANCH}), {
        headers: getGiteeHeaders()
    });
    const data = await res.json().catch(() => ({}));

    if (res.status === 404) {
        return [];
    }

    if (!res.ok) {
        console.error('Gitee directory lookup failed', {
            status: res.status,
            message: data.message,
            directory
        });
        throw error(502, data.message || 'Gitee 目录查询失败');
    }

    return Array.isArray(data) ? data : [];
}

async function deleteGiteeFile(file) {
    if (!file || !file.path || !file.sha) {
        return;
    }

    const res = await fetch(buildGiteeUrl(file.path, {
        message: `Delete replaced file ${file.path}`,
        sha: file.sha,
        branch: GITEE_BRANCH
    }), {
        method: 'DELETE',
        headers: getGiteeHeaders()
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok && res.status !== 404) {
        console.error('Gitee replaced file delete failed', {
            status: res.status,
            message: data.message,
            path: file.path
        });
        throw error(502, data.message || 'Gitee 旧文件删除失败');
    }
}

async function deleteReplacedFiles(target) {
    if (target.nameMode !== 'overwrite') {
        return;
    }

    const knownExtensions = [...new Set(Object.values(FILE_EXTENSIONS))];
    const replaceableNames = new Set(knownExtensions.map(ext => `${target.baseName}.${ext}`));
    const files = await listGiteeDirectory(target.directory);
    const staleFiles = files.filter(file => (
        file.type !== 'dir' &&
        file.path !== target.path &&
        replaceableNames.has(file.name)
    ));

    await Promise.all(staleFiles.map(deleteGiteeFile));
}

async function saveToGitee(target, base64) {
    const existingFile = target.nameMode === 'overwrite'
        ? await getGiteeFile(target.path)
        : null;
    const method = existingFile ? 'PUT' : 'POST';
    const body = {
        content: base64,
        message: `${method === 'PUT' ? 'Update' : 'Upload'} file ${target.path}`,
        branch: GITEE_BRANCH
    };

    if (existingFile && existingFile.sha) {
        body.sha = existingFile.sha;
    }

    const res = await fetch(buildGiteeUrl(target.path), {
        method,
        headers: getGiteeHeaders({
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
        }),
        body: buildContentForm(body)
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
        console.error('Gitee file save failed', {
            status: res.status,
            message: data.message,
            path: target.path
        });
        throw error(502, data.message || 'Gitee 文件上传失败');
    }

    const url = data.content && data.content.download_url;
    if (!url) {
        throw error(502, 'Gitee 未返回文件地址');
    }

    await deleteReplacedFiles(target);

    return {
        operation: method === 'PUT' ? 'updated' : 'created',
        url,
        sha: data.content.sha || '',
        raw: data
    };
}

async function upload({event, body}) {
    const user = await getCurrentWxUser(event);
    const extension = getImageExtension(body);
    const image = decodeImage(body);
    const target = buildTargetPath(body, user, extension);
    const result = await saveToGitee(target, image.base64);

    return {
        url: result.url,
        path: target.path,
        name: target.name,
        directory: target.directory,
        nameMode: target.nameMode,
        operation: result.operation,
        sha: result.sha
    };
}

const router = {
    upload
};

exports.handler = createHandler(router, {
    publicRoutes: ['upload'],
    skipConnectRoutes: ['upload']
});
