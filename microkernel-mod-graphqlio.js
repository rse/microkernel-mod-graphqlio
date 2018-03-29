/*
**  Microkernel -- Microkernel for Server Applications
**  Copyright (c) 2017 Ralf S. Engelschall <rse@engelschall.com>
**
**  Permission is hereby granted, free of charge, to any person obtaining
**  a copy of this software and associated documentation files (the
**  "Software"), to deal in the Software without restriction, including
**  without limitation the rights to use, copy, modify, merge, publish,
**  distribute, sublicense, and/or sell copies of the Software, and to
**  permit persons to whom the Software is furnished to do so, subject to
**  the following conditions:
**
**  The above copyright notice and this permission notice shall be included
**  in all copies or substantial portions of the Software.
**
**  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
**  EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
**  MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
**  IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
**  CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
**  TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
**  SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

/*  external requirements (non-standard)  */
const Ducky      = require("ducky")
const { Server } = require("graphql-io-server")

/*  the Microkernel module  */
class Module {
    constructor (options = {}) {
        /*  support options very similar to underlying GraphQL IO Server  */
        this.options = Ducky.options({
            prefix:      [ "string", "GraphQL-IO-" ],
            name:        [ "string", "GraphQL-IO-Server" ],
            host:        [ "string", "127.0.0.1" ],
            port:        [ "number", 8080 ],
            tls: {
                crt:     [ "string", "" ],
                key:     [ "string", "" ]
            },
            ttl:         [ "number", 7 * 24 * 60 * 60 * 1000 ],
            pubsub:      [ "string", "spm" ],
            keyval:      [ "string", "spm" ],
            secret:      [ "string", "" ],
            frontend:    [ "string", "" ],
            graphiql:    [ "boolean", true ],
            encoding:    [ "/^(?:cbor|msgpack|json)$/", "json" ],
            debug:       [ "number", 9 ],
            example:     [ "string", "" ]
        }, options)
    }
    get module () {
        /*  identity module  */
        return {
            name:  "microkernel-mod-graphqlio",
            tag:   "GRAPHQLIO",
            group: "BASE"
        }
    }
    latch (kernel) {
        /*  allow some options to be conveniently overwritten via CLI options  */
        kernel.latch("options:options", (options) => {
            options.push({
                names: [ "host", "H" ], type: "string", "default": this.options.host,
                help: "IP address to listen", helpArg: "ADDRESS" })
            options.push({
                names: [ "port", "P" ], type: "integer", "default": this.options.port,
                help: "TCP port to listen", helpArg: "PORT" })
            options.push({
                names: [ "crt" ], type: "string", "default": this.options.tls.crt,
                help: "use X.509 certificate for TLS", helpArg: "FILE" })
            options.push({
                names: [ "key" ], type: "string", "default": this.options.tls.key,
                help: "use private key for TLS", helpArg: "FILE" })
            options.push({
                names: [ "secret" ], type: "string", "default": this.options.secret,
                help: "use secret for JSON Web Tokens (JWT)", helpArg: "SECRET" })
        })
    }
    prepare (kernel) {
        /*  we operate only in standalone and worker mode  */
        if (!kernel.rs("ctx:procmode").match(/^(?:standalone|worker)$/))
            return

        /*  determine CLI options  */
        let cliOptions = kernel.rs("options:options")

        /*  sanity check TLS usage  */
        if (   (cliOptions.key !== "" && cliOptions.crt === "")
            || (cliOptions.key === "" && cliOptions.crt !== ""))
            throw new Error("TLS requires both Certificate and Key")

        /*  determine GraphQL-IO Server options  */
        let withTLS = (cliOptions.crt !== "" && cliOptions.key !== "")
        let protocol = withTLS ? "https" : "http"
        let url = `${protocol}://${cliOptions.host}:${cliOptions.port}`
        let opts = {
            prefix:   this.options.prefix,
            name:     this.options.name,
            url:      url,
            pubsub:   this.options.pubsub,
            keyval:   this.options.keyval,
            frontend: this.options.frontend,
            graphiql: this.options.graphiql,
            encoding: this.options.encoding,
            debug:    this.options.debug
        }
        if (cliOptions.secret !== "")
            opts.secret = cliOptions.secret
        if (this.options.example !== "")
            opts.example = this.options.example
        if (withTLS)
            opts.tls = { crt: cliOptions.crt, key: cliOptions.key }

        /*  create GraphQL-IO Server instance  */
        let server = new Server(opts)
        kernel.rs("graphqlio", server)

        /*  pass-through debug information from GraphQL-IO to Microkernel  */
        server.on("debug", ({ date, level, msg, log }) => {
            let levelName
            if      (level === 1) levelName = "info"
            else if (level === 2) levelName = "trace"
            else                  levelName = "debug"
            kernel.sv("log", "graphqlio", levelName, msg)
        })

        /*  display network interaction information  */
        const displayListenHint = ([ scheme, proto ]) => {
            let url = `${scheme}://${cliOptions.host}:${cliOptions.port}/api`
            kernel.sv("log", "graphqlio", "info", `listen on ${url} (${proto})`)
        }
        displayListenHint(withTLS ?
            [ "https", "HTTP/{1.0,1.1,2.0} + SSL/TLS" ] :
            [ "http",  "HTTP/{1.0,1.1}" ])
        displayListenHint(withTLS ?
            [ "wss", "WebSockets + SSL/TLS" ] :
            [ "ws",  "WebSockets" ])
    }
    start (kernel) {
        /*  we operate only in standalone and worker mode  */
        if (!kernel.rs("ctx:procmode").match(/^(?:standalone|worker)$/))
            return

        /*  start the HAPI service  */
        return new Promise((resolve, reject) => {
            kernel.rs("graphqlio").start().then((err) => {
                if (err) {
                    kernel.sv("fatal", "failed to start GraphQL-IO service")
                    reject(err)
                }
                else {
                    kernel.sv("log", "graphqlio", "info", "started GraphQL-IO service")
                    resolve()
                }
            })
        })
    }
    stop (kernel) {
        /*  we operate only in standalone and worker mode  */
        if (!kernel.rs("ctx:procmode").match(/^(?:standalone|worker)$/))
            return

        /*   stop the GraphQL-IO service  */
        kernel.sv("log", "graphqlio", "info", "gracefully stopping GraphQL-IO service")
        return kernel.rs("graphqlio").stop()
    }
}

/*  export the Microkernel module  */
module.exports = Module

