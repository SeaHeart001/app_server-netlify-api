### mongodb

Schema（模式对象）
——Schema 对象定义约束了数据库中的文档结构

Model
——Model 对象作为集合中的所有文档的表示，相当于MongoDB中的collection，它的每一个实例就是一个document文档

Document
——Document表示集合中的具体文档，相当于collection中的一个具体文档

关系：Schema生成Model，Model创造Document

```
Model 常用方法
   Model.[operations]
   eg : Model.find()
        Model.init()
        Model.validate()
        Model.save()
        Model.remove()
        Model.count()
        Model.find()
        Model.findOne()
        Model.findOneAndRemove()
        Model.findOneAndUpdate()
        Model.insertMany()
        Model.update()
```

根据主键增删改查某一项数据, 这写法TMD过于诡异   
```
router.post('/test2/:id', auth, async (req,res) =>{
    let breakFlag = false;
    Tasks.find({userId:req._initId}).then( (data)=>{
        for(let i=0; i<data.length; i++){
            let doc = data[i];
            for(let j=0; j<doc.tasks.length; j++){
                if(breakFlag){
                    break
                }
                let taskDoc = doc.tasks[j];
                if(taskDoc.id === req.params.id){
                    //增加数据的时候，只能添加已有模型字段的数据
                    // taskDoc.list.push({
                    //     pre_package_time: "2021-07-16 09:00:00",
                    //     pre_release_time: "2021-07-16 13:19:37",
                    //     remark: "11223344rrrrrrvvvvv"
                    // })
                    // doc.save()
                    res.json(taskDoc) //查
                    //res.json({message: '增加成功'})
                }
                for(let k=0; j<taskDoc.list.length; k++){
                    if(breakFlag){
                        break
                    }
                    let processDoc = taskDoc.list[k];
                    if(processDoc.id === req.params.id){
                        processDoc.remark = '11223344rrrrrrvvvvvwwwwww' //改
                        // processDoc.remove() //删
                        doc.save() //最后一定要在父模型上保存
                        res.json(doc)
                        breakFlag = true;
                        if(breakFlag){
                            break
                        }
                    }
                }
            }
        }
    })

})
router.post('/test/:id', auth, async (req,res) =>{

    Tasks.updateOne({'tasks._id': req.params.id},
        {
            $set:{
                //都2021年了占位符居然还时不支持多个?
                "tasks.$.product":'123123123131313'
            }
        }).then(data => {
        res.json(data)
    }).catch( e => {
        res.json(e)
    })

})
```



