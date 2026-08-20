const {MessageType} = require('../db/model/messageTypeModel');
const {connect} = require('../db');
const {error} = require('../utils');

const DEFAULT_TYPES = [
    {code: 'pat', name: '拍一拍', defaultTitle: '消息通知', defaultContent: '对方拍了拍你', category: 'interaction'}
];

async function ensureDefaultTypes() {
    const count = await MessageType.countDocuments();
    if (count === 0) {
        await MessageType.insertMany(DEFAULT_TYPES);
    }
}

async function createMessageType({body}) {
    await connect();
    const code = String(body.code || '').trim();
    const name = String(body.name || '').trim();

    if (!code || !name) {
        throw error(400, 'code 和 name 不能为空');
    }

    const existing = await MessageType.findOne({code});
    if (existing) {
        throw error(400, '消息类型已存在');
    }

    const doc = await MessageType.create({
        code,
        name,
        defaultTitle: String(body.defaultTitle || '消息通知').trim(),
        defaultContent: String(body.defaultContent || '').trim(),
        category: 'interaction'
    });

    return {type: formatType(doc)};
}

async function listMessageTypes() {
    await connect();
    await ensureDefaultTypes();
    const types = await MessageType.find().sort({createdAt: 1}).lean();
    return {types: types.map(formatType)};
}

async function updateMessageType({body}) {
    await connect();
    const code = String(body.code || '').trim();
    if (!code) {
        throw error(400, 'code 不能为空');
    }

    const updates = {};
    if (body.name !== undefined) updates.name = String(body.name).trim();
    if (body.defaultTitle !== undefined) updates.defaultTitle = String(body.defaultTitle).trim();
    if (body.defaultContent !== undefined) updates.defaultContent = String(body.defaultContent).trim();
    if (body.category !== undefined) updates.category = 'interaction';

    const doc = await MessageType.findOneAndUpdate(
        {code},
        {$set: updates},
        {new: true}
    );

    if (!doc) {
        throw error(404, '消息类型不存在');
    }

    return {type: formatType(doc)};
}

function formatType(doc) {
    return {
        code: doc.code,
        name: doc.name,
        defaultTitle: doc.defaultTitle,
        defaultContent: doc.defaultContent,
        category: doc.category
    };
}

const router = {
    create: createMessageType,
    list: listMessageTypes,
    update: updateMessageType
};

const routes = Object.keys(router);

module.exports = {
    createMessageType,
    listMessageTypes,
    updateMessageType,
    router,
    routes
};
