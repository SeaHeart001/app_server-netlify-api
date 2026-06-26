const {Marvels} = require('../../db/marvel/marvelModel');
const {Messages} = require('../../db/message/messageModel');
const {createHandler, error} = require('../utils');

function toStringArray(value) {
    return Array.isArray(value) ? value.map(item => String(item)) : [];
}

async function add({body}) {
    if (!body.name || !body.avatar) {
        throw error(400, '缺少参数: name, avatar');
    }

    await Marvels.create({
        name: body.name,
        avatar: body.avatar,
        score: []
    });

    return {message: '添加成功'};
}

async function set({event, body}) {
    if (!body.id) {
        throw error(400, '缺少参数: id');
    }

    if (!event._user.relation) {
        throw error(400, '请先匹配关系');
    }

    const marvel = await Marvels.findById(body.id);
    if (!marvel) {
        throw error(404, '记录不存在');
    }

    const userId = String(event._user.id);
    const relationId = String(event._user.relation);
    const scores = toStringArray(marvel.score);

    if (scores.includes(userId)) {
        return {message: '请勿重复操作'};
    }

    marvel.score.push(userId);

    const sex = event._user.sex === 1 ? '男' : '女';
    const msg = scores.includes(relationId)
        ? `恭喜你们，“${marvel.name}”已成功点亮`
        : `你的${sex}朋友请求点亮“${marvel.name}”`;

    await Promise.all([
        marvel.save(),
        Messages.create({
            msg,
            to: event._user.relation,
            from: event._user.id,
            msgType: 2
        })
    ]);

    return {message: '操作成功'};
}

async function list({event}) {
    const list = await Marvels.find({}).lean();

    if (event._user.admin === 1) {
        return {data: list};
    }

    const userId = String(event._user.id);
    const relationId = event._user.relation ? String(event._user.relation) : '';
    const data = list.map(item => {
        const score = toStringArray(item.score);
        let scoreNum = 0;

        if (score.includes(userId)) {
            scoreNum++;
        }

        if (relationId && score.includes(relationId)) {
            scoreNum++;
        }

        return {...item, scoreNum};
    });

    return {data};
}

async function remove({body}) {
    const ids = Array.isArray(body.ids) ? body.ids : [];
    if (ids.length === 0) {
        throw error(400, '缺少参数: ids');
    }

    await Marvels.deleteMany({_id: {$in: ids}});

    return {message: '删除成功'};
}

const router = {
    add,
    set,
    list,
    remove
};

exports.handler = createHandler(router, {
    adminRoutes: ['add', 'remove']
});
