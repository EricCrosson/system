import { range } from "../src/Array"
import type { Cb, Effect } from "../src/Effect"
import * as T from "../src/Effect"
import * as E from "../src/Either"
import * as Ex from "../src/Exit"
import * as Fiber from "../src/Fiber"
import { dump, prettyPrintM } from "../src/Fiber"
import * as FiberRef from "../src/FiberRef"
import { absurd, flow, pipe, tuple } from "../src/Function"
import * as O from "../src/Option"

describe("Effect", () => {
  it("absolve", async () => {
    const program = T.absolve(T.succeed(E.left("e")))

    expect(await pipe(program, T.result, T.map(Ex.untraced), T.runPromise)).toEqual(
      Ex.fail("e")
    )
  })
  it("absorbWith", async () => {
    const program = pipe(T.die("e"), T.absorbWith(absurd))
    const program2 = pipe(
      T.fail("e"),
      T.absorbWith((e) => `${e}-ok`)
    )

    expect(await pipe(program, T.result, T.map(Ex.untraced), T.runPromise)).toEqual(
      Ex.fail("e")
    )
    expect(await pipe(program2, T.result, T.map(Ex.untraced), T.runPromise)).toEqual(
      Ex.fail("e-ok")
    )
  })
  it("tupled", async () => {
    const program = T.tuple(T.succeed(0), T.succeed("ok"), T.fail("e"))
    expect(await pipe(program, T.result, T.map(Ex.untraced), T.runPromise)).toEqual(
      Ex.fail("e")
    )
  })
  it("mapN", async () => {
    const program = pipe(
      tuple(T.succeed(0), T.fail("e"), T.succeed("ok")),
      T.mapN(([a, _, c]) => a + c.length)
    )
    expect(await pipe(program, T.result, T.map(Ex.untraced), T.runPromise)).toEqual(
      Ex.fail("e")
    )
  })
  it("memoize", async () => {
    const m = jest.fn()
    const result = await pipe(
      T.memoize((n: number) =>
        T.effectTotal(() => {
          m(n)
          return n + 1
        })
      ),
      T.chain((f) =>
        T.struct({
          a: f(0),
          b: f(0),
          c: f(1),
          d: f(1)
        })
      ),
      T.result,
      T.map(Ex.untraced),
      T.runPromise
    )

    expect(result).toEqual(Ex.succeed({ a: 1, b: 1, c: 2, d: 2 }))
    expect(m).toHaveBeenNthCalledWith(1, 0)
    expect(m).toHaveBeenNthCalledWith(2, 1)
    expect(m).toHaveBeenCalledTimes(2)
  })
  it("raceAll - wait", async () => {
    const a = jest.fn()
    const b = jest.fn()
    const c = jest.fn()

    const program = T.raceAll(
      [
        T.effectAsyncInterrupt<unknown, never, number>((cb) => {
          const t = setTimeout(() => {
            cb(T.succeed(1))
          }, 5000)
          return T.effectTotal(() => {
            a()
            clearTimeout(t)
          })
        }),
        T.effectAsyncInterrupt<unknown, never, number>((cb) => {
          const t = setTimeout(() => {
            cb(T.succeed(2))
          }, 100)
          return T.effectTotal(() => {
            b()
            clearTimeout(t)
          })
        }),
        T.effectAsyncInterrupt<unknown, never, number>((cb) => {
          const t = setTimeout(() => {
            cb(T.succeed(3))
          }, 5000)
          return T.effectTotal(() => {
            c()
            clearTimeout(t)
          })
        })
      ],
      "wait"
    )

    const result = await pipe(program, T.result, T.map(Ex.untraced), T.runPromise)

    expect(result).toEqual(Ex.succeed(2))

    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(0)
    expect(c).toHaveBeenCalledTimes(1)
  })
  it("raceAll", async () => {
    const a = jest.fn()
    const b = jest.fn()
    const c = jest.fn()

    const program = T.raceAll([
      T.effectAsyncInterrupt<unknown, never, number>((cb) => {
        const t = setTimeout(() => {
          cb(T.succeed(1))
        }, 5000)
        return T.effectTotal(() => {
          a()
          clearTimeout(t)
        })
      }),
      T.effectAsyncInterrupt<unknown, never, number>((cb) => {
        const t = setTimeout(() => {
          cb(T.succeed(2))
        }, 100)
        return T.effectTotal(() => {
          b()
          clearTimeout(t)
        })
      }),
      T.effectAsyncInterrupt<unknown, never, number>((cb) => {
        const t = setTimeout(() => {
          cb(T.succeed(3))
        }, 5000)
        return T.effectTotal(() => {
          c()
          clearTimeout(t)
        })
      })
    ])

    const result = await pipe(program, T.result, T.map(Ex.untraced), T.runPromise)

    expect(result).toEqual(Ex.succeed(2))

    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(0)
    expect(c).toHaveBeenCalledTimes(1)
  })
  it("timeout", async () => {
    const f = jest.fn()
    const result = await pipe(
      T.effectAsyncInterrupt<unknown, never, number>((cb) => {
        const timer = setTimeout(() => {
          cb(T.succeed(1))
        }, 2000)
        return T.effectTotal(() => {
          f()
          clearTimeout(timer)
        })
      }),
      T.timeout(100),
      T.runPromise
    )

    expect(result).toEqual(O.none)
    expect(f).toHaveBeenCalledTimes(1)
  })
  it("timeoutFail", async () => {
    const f = jest.fn()
    const result = await pipe(
      T.effectAsyncInterrupt<unknown, never, number>((cb) => {
        const timer = setTimeout(() => {
          cb(T.succeed(1))
        }, 2000)
        return T.effectTotal(() => {
          f()
          clearTimeout(timer)
        })
      }),
      T.timeoutFail(100, () => "timeout"),
      T.result,
      T.map(Ex.untraced),
      T.runPromise
    )

    expect(result).toEqual(Ex.fail("timeout"))
    expect(f).toHaveBeenCalledTimes(1)
  })
  it("chainError", async () => {
    const result = await pipe(
      T.fail("error"),
      T.chainError((e) => T.effectTotal(() => `(${e})`)),
      T.result,
      T.map(Ex.untraced),
      T.runPromise
    )

    expect(result).toEqual(Ex.fail("(error)"))
  })
  it(
    "forkAs",
    async () => {
      const result = await pipe(
        FiberRef.get(Fiber.fiberName),
        T.delay(5),
        T.forkAs("fiber-A"),
        T.tap(
          flow(
            dump,
            T.chain(prettyPrintM),
            T.chain((text) => T.effectTotal(() => console.log(text)))
          )
        ),
        T.tap(
          flow(
            dump,
            T.delay(10),
            T.chain(prettyPrintM),
            T.chain((text) => T.effectTotal(() => console.log(text)))
          )
        ),
        T.chain(Fiber.join),
        T.runPromise
      )
      expect(result).toEqual(O.some("fiber-A"))
    },
    15 * 1000
  )
  it("effectAsyncM", async () => {
    const result = await pipe(
      T.effectAsyncM((cb: Cb<Effect<{ bar: string }, never, string>>) =>
        T.access((r: { foo: string }) => {
          setTimeout(() => {
            cb(T.access((b) => `${r.foo} - ${b.bar}`))
          }, 200)
        })
      ),
      T.provideAll({ bar: "bar", foo: "foo" }),
      T.runPromise
    )

    expect(result).toEqual("foo - bar")
  })
  it("foreachParN", async () => {
    const result = await pipe(
      range(0, 100),
      T.foreachParN(3, (n) =>
        pipe(
          T.sleep(100),
          T.chain(() =>
            n > 1 && n % 5 === 0 ? T.fail(`error in process: ${n}`) : T.succeed(n)
          )
        )
      ),
      T.result,
      T.map(Ex.untraced),
      T.runPromise
    )
    const result_ok = await pipe(
      range(0, 100),
      T.foreachParN(10, (n) =>
        pipe(
          T.sleep(10),
          T.map(() => n)
        )
      ),
      T.result,
      T.map(Ex.untraced),
      T.runPromise
    )

    expect(result).toEqual(Ex.fail("error in process: 5"))
    expect(result_ok).toEqual(Ex.succeed(range(0, 100)))
  })
  it("catchAllDefect", async () => {
    const a = await pipe(T.die("LOL"), T.catchAllDefect(T.succeed), T.runPromise)
    expect(a).toEqual("LOL")
  })
  it("bindAll", async () => {
    expect(
      await pipe(
        T.do,
        T.bind("a", () => T.succeed(0)),
        T.bindAll(({ a }) => ({
          b: T.succeed(a + 1),
          c: T.succeed(a + 2)
        })),
        T.runPromise
      )
    ).toEqual({ a: 0, b: 1, c: 2 })
  })
})
