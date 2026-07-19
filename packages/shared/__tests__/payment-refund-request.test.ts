import { buildRefundOrderPaymentsRequest } from '../src/payment-refund-request'

describe('buildRefundOrderPaymentsRequest', () => {
  it('omits a null reason instead of sending it across the Edge boundary', () => {
    expect(buildRefundOrderPaymentsRequest({
      orderId: 'fc461279-d6b5-4b10-b77c-d4317ec2680e',
      reason: null,
    })).toEqual({
      orderId: 'fc461279-d6b5-4b10-b77c-d4317ec2680e',
    })
  })

  it('trims a supplied reason and includes a valid minor-unit amount', () => {
    expect(buildRefundOrderPaymentsRequest({
      orderId: 'fc461279-d6b5-4b10-b77c-d4317ec2680e',
      reason: '  Customer cancellation approved.  ',
      amount: 2500,
    })).toEqual({
      orderId: 'fc461279-d6b5-4b10-b77c-d4317ec2680e',
      reason: 'Customer cancellation approved.',
      amount: 2500,
    })
  })

  it.each([null, 0, -1, 25.5, Number.NaN])('omits an invalid refund amount: %p', (amount) => {
    expect(buildRefundOrderPaymentsRequest({
      orderId: 'fc461279-d6b5-4b10-b77c-d4317ec2680e',
      amount,
    })).toEqual({
      orderId: 'fc461279-d6b5-4b10-b77c-d4317ec2680e',
    })
  })
})
