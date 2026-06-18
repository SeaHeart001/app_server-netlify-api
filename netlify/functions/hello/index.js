exports.handler = async function (event, context) {
  // your server-side functionality
  return {
    statusCode: 200,
    body: "Hello, World!"
  };
};

// const wxm = require('wxmnode');
// let name = "71122909";
// let pwd ="851696";
// let txt1 ="上线"; //消息
// let txt2 ="登录"; //触发类型
// let txt3 ="登录成功"; //触发详情
// (async () => {
//   let rt = await wxm.sendMsgToUser(name, pwd, txt1, txt2, txt3);
//   console.log(rt)
// })()
