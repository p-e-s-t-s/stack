import { describe, expect, it } from 'vitest'
import { addresses, message } from '../src'

const config = { from: 'magpie@example.com', to: 'a@example.com, b@example.org' }

describe('email message', () => {
  it('builds text and escaped HTML with a stable Message-ID', () => {
    const mail = message({ type: 'x', title: 'Tom & <Jerry>', body: '"hi"' }, config, '42')
    expect(mail).toMatchObject({
      from: 'magpie@example.com',
      to: ['a@example.com', 'b@example.org'],
      subject: 'Tom & <Jerry>',
      messageId: '<magpie-42@example.com>',
      text: 'Tom & <Jerry>\n\n"hi"\n',
    })
    expect(mail.html).toBe('<p><strong>Tom &#38; &#60;Jerry&#62;</strong></p><p>&#34;hi&#34;</p>')
  })

  it('cannot add headers through the title', () => {
    const mail = message({ type: 'x', title: 'Hello\r\nBcc: evil@example.com' }, config)
    expect(mail.subject).toBe('Hello Bcc: evil@example.com')
    expect(mail.subject).not.toMatch(/[\r\n]/)
  })

  it('rejects addresses that could inject headers or recipients', () => {
    expect(() => addresses('a@example.com\r\nBcc: x@example.com', 'to')).toThrow('invalid')
    expect(() => addresses('Evil <a@example.com>', 'to')).toThrow('invalid')
    expect(() => addresses('', 'to')).toThrow('empty')
  })
})
