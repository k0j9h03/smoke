const canvasEl = document.querySelector("canvas");

const pointer = {
    x: 0, y: 0, dx: 0, dy: 0, moved: false,
};

let outputColor, velocity, divergence, pressure;

const gl = canvasEl.getContext("webgl");
gl.getExtension("OES_texture_float");

const vertexShader = createShader(
    document.getElementById("vertShader").innerHTML,
    gl.VERTEX_SHADER
);
const splatProgram = createProgram("fragShaderPoint");
const divergenceProgram = createProgram("fragShaderDivergence");
const pressureProgram = createProgram("fragShaderPressure");
const gradientSubtractProgram = createProgram("fragShaderGradientSubtract");
const advectionProgram = createProgram("fragShaderAdvection");
const outputShaderProgram = createProgram("fragShaderOutputShader");

gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, -1,1, 1,1, 1,-1]), gl.STATIC_DRAW);
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0,1,2, 0,2,3]), gl.STATIC_DRAW);
gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
gl.enableVertexAttribArray(0);

initFBOs();
setupEvents();
resizeCanvas();
window.addEventListener("resize", resizeCanvas);
render();

function createShader(source, type) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(shader));
        return null;
    }
    return shader;
}

function createProgram(elId) {
    const shader = createShader(
        document.getElementById(elId).innerHTML,
        gl.FRAGMENT_SHADER
    );
    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, shader);
    gl.linkProgram(program);
    const uniforms = {};
    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < count; i++) {
        let name = gl.getActiveUniform(program, i).name;
        uniforms[name] = gl.getUniformLocation(program, name);
    }
    return { program, uniforms };
}

function initFBOs() {
    const w = Math.floor(window.innerWidth * 0.5);
    const h = Math.floor(window.innerHeight * 0.5);
    outputColor = createDoubleFBO(w, h);
    velocity = createDoubleFBO(w, h, gl.RG);
    divergence = createFBO(w, h, gl.RGB);
    pressure = createDoubleFBO(w, h, gl.RGB);
}

function createFBO(w, h, type = gl.RGBA) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, type, w, h, 0, type, gl.FLOAT, null);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { fbo, width: w, height: h, attach(id) { gl.activeTexture(gl.TEXTURE0 + id); gl.bindTexture(gl.TEXTURE_2D, tex); return id; }};
}

function createDoubleFBO(w, h, type) {
    let fbo1 = createFBO(w, h, type);
    let fbo2 = createFBO(w, h, type);
    return {
        width: w, height: h,
        texelSizeX: 1 / w, texelSizeY: 1 / h,
        read: () => fbo1,
        write: () => fbo2,
        swap() { [fbo1, fbo2] = [fbo2, fbo1]; }
    };
}

function resizeCanvas() {
    canvasEl.width = window.innerWidth;
    canvasEl.height = window.innerHeight;
    initFBOs();
}

function setupEvents() {
    canvasEl.addEventListener("mousemove", (e) => {
        updateMousePosition(e.pageX, e.pageY);
    });
    canvasEl.addEventListener("touchmove", (e) => {
        e.preventDefault();
        updateMousePosition(e.touches[0].pageX, e.touches[0].pageY);
    });
}

function updateMousePosition(x, y) {
    pointer.moved = true;
    pointer.dx = 5 * (x - pointer.x);
    pointer.dy = 5 * (y - pointer.y);
    pointer.x = x;
    pointer.y = y;
}

function blit(target) {
    if (target == null) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    } else {
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
        gl.viewport(0, 0, target.width, target.height);
    }
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
}

function render() {
    const dt = 1 / 60;
    if (pointer.moved) {
        pointer.moved = false;
        gl.useProgram(splatProgram.program);
        gl.uniform1i(splatProgram.uniforms.u_input_texture, velocity.read().attach(1));
        gl.uniform1f(splatProgram.uniforms.u_ratio, canvasEl.width / canvasEl.height);
        gl.uniform2f(splatProgram.uniforms.u_point, pointer.x / canvasEl.width, 1 - pointer.y / canvasEl.height);
        gl.uniform3f(splatProgram.uniforms.u_point_value, pointer.dx, -pointer.dy, 1);
        gl.uniform1f(splatProgram.uniforms.u_point_size, 0.01);
        blit(velocity.write());
        velocity.swap();

        gl.uniform1i(splatProgram.uniforms.u_input_texture, outputColor.read().attach(1));
        gl.uniform3f(splatProgram.uniforms.u_point_value, 1., 0., 0.);
        blit(outputColor.write());
        outputColor.swap();
    }

    gl.useProgram(divergenceProgram.program);
    gl.uniform2f(divergenceProgram.uniforms.u_texel, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(divergenceProgram.uniforms.u_velocity_texture, velocity.read().attach(1));
    blit(divergence);

    gl.useProgram(pressureProgram.program);
    gl.uniform2f(pressureProgram.uniforms.u_texel, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(pressureProgram.uniforms.u_divergence_texture, divergence.attach(1));
    for (let i = 0; i < 10; i++) {
        gl.uniform1i(pressureProgram.uniforms.u_pressure_texture, pressure.read().attach(2));
        blit(pressure.write());
        pressure.swap();
    }

    gl.useProgram(gradientSubtractProgram.program);
    gl.uniform2f(gradientSubtractProgram.uniforms.u_texel, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(gradientSubtractProgram.uniforms.u_pressure_texture, pressure.read().attach(1));
    gl.uniform1i(gradientSubtractProgram.uniforms.u_velocity_texture, velocity.read().attach(2));
    blit(velocity.write());
    velocity.swap();

    gl.useProgram(advectionProgram.program);
    gl.uniform1f(advectionProgram.uniforms.u_use_text, 0);
    gl.uniform2f(advectionProgram.uniforms.u_texel, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(advectionProgram.uniforms.u_velocity_texture, velocity.read().attach(1));
    gl.uniform1i(advectionProgram.uniforms.u_input_texture, velocity.read().attach(1));
    gl.uniform1f(advectionProgram.uniforms.u_dt, dt);
    blit(velocity.write());
    velocity.swap();

    gl.useProgram(advectionProgram.program);
    gl.uniform1f(advectionProgram.uniforms.u_use_text, 0);
    gl.uniform2f(advectionProgram.uniforms.u_texel, outputColor.texelSizeX, outputColor.texelSizeY);
    gl.uniform1i(advectionProgram.uniforms.u_input_texture, outputColor.read().attach(2));
    blit(outputColor.write());
    outputColor.swap();

    gl.useProgram(outputShaderProgram.program);
    gl.uniform1i(outputShaderProgram.uniforms.u_output_texture, outputColor.read().attach(1));
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);

    requestAnimationFrame(render);
}
