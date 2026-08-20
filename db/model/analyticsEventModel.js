const mongoose = require('mongoose');

const AnalyticsEventSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        index: true
    },
    type: {
        type: String,
        required: true,
        index: true
    },
    year: {
        type: Number,
        required: true
    },
    properties: {
        type: mongoose.Schema.Types.Mixed,
        default: function () {
            return {};
        }
    },
    createdAt: {
        type: Date,
        default: function () {
            return new Date();
        }
    }
});

AnalyticsEventSchema.index({userId: 1, createdAt: -1});
AnalyticsEventSchema.index({userId: 1, type: 1, createdAt: -1});
AnalyticsEventSchema.index({type: 1, createdAt: 1});
AnalyticsEventSchema.index({createdAt: 1});

const AnalyticsEvent = mongoose.models.analyticsEvents || mongoose.model('analyticsEvents', AnalyticsEventSchema);

module.exports = {AnalyticsEvent};
