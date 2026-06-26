const mongoose = require('mongoose');

const TasksSchema =new mongoose.Schema({
    tasks: {
        type: String,
        required: true
    },
    creator: {
        type: String,
        required: true
    },
    createTime: {
        type: Date,
        default: function(){
            return new Date()
        }
    },
})

const Tasks = mongoose.models.tasks || mongoose.model('tasks', TasksSchema);

// Tasks.watch().on('change', data => {
//     console.log(data)
// });


module.exports = {Tasks}
