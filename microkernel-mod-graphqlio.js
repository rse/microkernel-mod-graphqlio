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
import Promise       from "bluebird"
import Ducky         from "ducky"
import { Server }    from "graphql-io-server"

export default class Module {
    constructor (options = {}) {
        this.options = Ducky.options({
            prefix:      [ "string", "GraphQL-IO-" ],
            name:        [ "string", "GraphQL-IO-Server" ],
            ttl:         [ "number", 7 * 24 * 60 * 60 * 1000 ],
            pubsub:      [ "string", "spm" ],
            keyval:      [ "string", "spm" ],
            frontend:    [ "string", "" ],
            graphiql:    [ "boolean", true ],
            encoding:    [ "/^(?:cbor|msgpack|json)$/", "json" ],
            debug:       [ "number", 0 ],
            example:     [ "string", null ]
        }, options)
    }
    get module () {
        return {
            name:  "microkernel-mod-hapi",
            tag:   "HAPI",
            group: "BASE"
        }
    }
    latch (kernel) {
        kernel.latch("options:options", (options) => {
            options.push({
                names: [ "host", "H" ], type: "string", "default": "127.0.0.1",
                help: "IP address to listen", helpArg: "ADDRESS" })
            options.push({
                names: [ "port", "P" ], type: "integer", "default": 8080,
                help: "TCP port to listen", helpArg: "PORT" })
            options.push({
                names: [ "tls" ], type: "bool", "default": false,
                help: "speak TLS on host/port" })
            options.push({
                names: [ "tls-key" ], type: "string", "default": null,
                help: "use private key for TLS", helpArg: "FILE" })
            options.push({
                names: [ "tls-cert" ], type: "string", "default": null,
                help: "use X.509 certificate for TLS", helpArg: "FILE" })
            options.push({
                names: [ "jwt-secret" ], type: "string", "default": "",
                help: "use secret for JSON Web Tokens (JWT)", helpArg: "SECRET" })
        })
    }
    prepare (kernel) {
        /*  we operate only in standalone and worker mode  */
        if (!kernel.rs("ctx:procmode").match(/^(?:standalone|worker)$/))
            return

        /*  create GraphQL-IO Server instance  */
        if (   kernel.rs("options:options").tls
            && (   kernel.rs("options:options").tls_key === null
                || kernel.rs("options:options").tls_cert === null))
            throw new Error("TLS requires Certificate/Key")
        let protocol = kernel.rs("options:options").tls ? "https" : "http"
        let url = `${protocol}:${kernel.rs("options:options").host}:${kernel.rs("options:options").port}`
        let opts = {
            prefix:   this.options.prefix,
            name:     this.options.name,
            url:      url,
            secret:   kernel.rs("options:options").jwt_secret,
            pubsub:   this.options.pubsub,
            keyval:   this.options.keyval,
            frontend: this.options.frontend,
            graphiql: this.options.graphiql,
            encoding: this.options.encoding,
            debug:    this.options.debug
        }
        if (this.options.example !== null)
            opts.example = this.options.example
        if (kernel.rs("options:options").tls) {
            opts.tls = {
                crt: kernel.rs("options:options").tls_cert,
                key: kernel.rs("options:options").tls_key
            }
        }
        let server = new Server(opts)
        kernel.rs("graphqlio", server)

        /*  display network interaction information  */
        const displayListenHint = ([ scheme, proto ]) => {
            let url = `${scheme}://${kernel.rs("options:options").host}:${kernel.rs("options:options").port}`
            kernel.sv("log", "graphiqlio", "info", `listen on ${url} (${proto})`)
        }
        displayListenHint(kernel.rs("options:options").tls ?
            [ "https", "HTTP/{1.0,1.1,2.0} + SSL/TLS" ] :
            [ "http",  "HTTP/{1.0,1.1}" ])
        displayListenHint(kernel.rs("options:options").tls ?
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

