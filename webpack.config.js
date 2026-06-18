var path = require('path');

var CopyWebpackPlugin = require("copy-webpack-plugin");

let externals = _externals();
module.exports = {
    mode: 'production',
    entry: './bin/www',
    target: 'node',
    output: {
        path: path.resolve(__dirname, 'build/'),
        filename: 'oauth-server.bundle.js'
    },
    node: {
        __dirname: true
    },
    module: {
        rules: [
            {
                use: {
                    loader: 'babel-loader',
                    options: {
                        presets: [['@babel/preset-env', {
                            "targets": {
                                "node": true
                            }
                        }]]
                    }
                },
                test: /\.js$/,
                // exclude: /node_modules/
            }
        ]
    },
    plugins: [
        new CopyWebpackPlugin([{
            from: path.resolve(__dirname, 'public'),
            to: path.resolve(__dirname, 'build/public')
        }]),
        // new CopyWebpackPlugin([{
        //     from: path.resolve(__dirname, 'node_modules'),
        //     to: path.resolve(__dirname, 'build/node_modules')
        // }])
    ],
    optimization: {
        minimize: true
    }
};

function _externals() {
    let manifest = require('./package.json');
    let dependencies = manifest.dependencies;
    let externals = {};
    for (let p in dependencies) {
        externals[p] = 'commonjs ' + p;
    }
    return externals;
}
