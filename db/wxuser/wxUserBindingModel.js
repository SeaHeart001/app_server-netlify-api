const mongoose = require('mongoose');

const WxUserBindingSchema = new mongoose.Schema({
    members: {
        type: [mongoose.Schema.Types.ObjectId],
        required: true,
        validate: {
            validator(value) {
                return Array.isArray(value) && value.length === 2 && String(value[0]) !== String(value[1]);
            },
            message: 'binding requires two different users'
        }
    },
    relationKey: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    status: {
        type: String,
        default: 'active',
        index: true
    },
    createdAt: {
        type: Date,
        default: function () {
            return new Date();
        }
    },
    updatedAt: {
        type: Date,
        default: function () {
            return new Date();
        }
    }
});

WxUserBindingSchema.index({members: 1, status: 1});

WxUserBindingSchema.pre('save', function (next) {
    this.updatedAt = new Date();
    next();
});

const WxUserBinding = mongoose.models.wxuserbindings || mongoose.model('wxuserbindings', WxUserBindingSchema);

module.exports = {WxUserBinding};
