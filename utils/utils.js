let codeStatus = [
    {
        code:1,
        message:"请求成功"
    },
    {
        code:0,
        message:"系统繁忙"
    }
]

const resData = {
    success: (res, data, options={}) => {
        if(typeof (data) !== 'object'){
            res.json({
                code: codeStatus[0].code,
                message: data || codeStatus[0].message
            })
            return
        }
        res.json({
            data: data,
            code: codeStatus[0].code,
            message: data.message || codeStatus[0].message,
            ...options
        })
    },
    error: (res, err, options={}) => {
        if(typeof (err) !== 'object'){
            res.json({
                code: codeStatus[1].code,
                message: err || codeStatus[1].message
            })
            return
        }
        res.json({
            data: err,
            code: codeStatus[1].code,
            message: err.message || codeStatus[1].message,
            ...options
        })
    },
}


function numToChinese(num) {
    this.chnum = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
    this.chsection = {
        unit: {
            2: '十',
            3: '百',
            4: '千',
            5: '万',
            9: '亿',
            13: '兆',
            17: ''
        },
        next: function (num) {
            for (let i in this.unit) {
                if (i > num) {
                    return i;
                }
            }
            return null;
        },
        get: function (index) {
            let min = 2, q;
            for (let i in this.unit) {
                if (i > index) {
                    q = index - min + 1;
                    break;
                }
                min = i;
            }
            return this.unit[q];
        }
    };
    const getUnit = (narr, i) => {
        const len = narr.length - i;
        const num = Number(narr[i]);
        if (len < 2) {
            return null;
        }
        let unit = this.chsection.unit[len];
        if (num === 0) {
            if (len < 5 || !unit) {
                return null;
            }
            let isZero = true;
            const next = this.chsection.next(len);
            if (!next) {
                isZero = false;
            } else {
                for (let i = len; i < next; i++) {
                    const index = narr.length - i;
                    if (narr[index] && narr[index] !== '0') {
                        isZero = false;
                        break;
                    }
                }
            }
            if (isZero) return null;
        }
        if (unit) {
            return unit;
        } else {
            return this.chsection.get(len);
        }
    }

    num = Number(num);
    if (num < 10) {
        return this.chnum[num];
    }
    let chstr = '';
    let zero = false;
    // let model = 0;
    const narr = String(num).split('');
    for (let index = 0; index < narr.length; index++) {
        const num = Number(narr[index]);
        const str = this.chnum[narr[index]];
        const unit = getUnit(narr, index);
        if (num === 0) {
            zero = true;
        }
        if (zero && num !== 0) {
            chstr += this.chnum[0];
            zero = false;
        }
        if (!zero && (unit !== '十' || num !== 1 || index !== 0))
            chstr += str;
        chstr += unit || '';
    }
    return chstr;
}


module.exports = { numToChinese, resData}
